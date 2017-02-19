/*
    This is used after initialization for all feeds on first startup.
    The main RSS file that is looping.

    The steps are nearly the same except that this is on a loop, and
    there is no filtering because all unseen data by checkTable is,
    by default, new data because it is on a loop.

    It still has to check the table however because the feedparser
    grabs ALL the data each time, new and old, through the link.
*/
const FeedParser = require('feedparser');
const requestStream = require('./request.js')
const translator = require('./translator/translate.js')
const sqlConnect = require('./sql/connect.js')
const sqlCmds = require('./sql/commands.js')
const sendToDiscord = require('../util/sendToDiscord.js')

function isEmptyObject(obj) {
  for (var key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      return false;
    }
  }
  return true;
}

module.exports = function (con, channel, rssIndex, sendingTestMessage, callback) {

  var feedparser = new FeedParser()
  var currentFeed = []

  var guild = require(`../sources/${channel.guild.id}.json`)
  var rssList = guild.sources

  requestStream(rssList[rssIndex].link, feedparser, function() {
    if (sendingTestMessage) channel.sendMessage("Unable to get test feed. Could not connect to feed link.");
    callback()
    feedparser.removeAllListeners('end')
  })

  feedparser.on('error', function (error) {
    console.log(`RSS Parsing Error: (${guild.id}, ${guild.name}) => ${error}, for link ${rssList[rssIndex].link}`)
    feedparser.removeAllListeners('end')
    return callback()
  });

  feedparser.on('readable',function () {
    var stream = this;
    var item;

    while (item = stream.read()) {
      currentFeed.push(item);
    }
});

  feedparser.on('end', function() {
    if (currentFeed.length == 0) {
      if (!sendingTestMessage) return callback();
      callback();
      console.log(`RSS Info: (${guild.id}, ${guild.name}) => "${rssList[rssIndex].name}" has no feeds to send for rsstest.`);
      return channel.sendMessage(`Feed "${rssList[rssIndex].link}" has no available RSS that can be sent.`);
    }

    let feedName = rssList[rssIndex].name
    var processedItems = 0
    var filteredItems = 0
    //console.log("RSS Info: Starting retrieval for: " + guild.id);

    function startDataProcessing() {
      checkTableExists();
    }

    function checkTableExists() {
      sqlCmds.selectTable(con, feedName, function (err, results) {
        if (err || isEmptyObject(results)) {
          if (err) console.log(`Database fatal error!. (${guild.id}, ${guild.name}) => RSS index ${rssIndex} Feed ${rssList[rssIndex].link}. Skipping because of error:`, err);
          else if (isEmptyObject(results)) console.log(`RSS Info: (${guild.id}, ${guild.name}) => "${rssList[rssIndex].name}" appears to have been deleted, skipping...`);
          return callback();
        }
        if (sendingTestMessage) {
          let randFeedIndex = Math.floor(Math.random() * (currentFeed.length - 1));
          checkTable(currentFeed[randFeedIndex]);
        }
        else {
          let feedLength = currentFeed.length - 1;
          for (var x = feedLength; x >= 0; x--){ //get feeds starting from oldest, ending with newest.
            if (currentFeed[0].guid == null && currentFeed[0].pubdate !== "Invalid Date") var feedId = currentFeed[x].pubdate;
            else if (currentFeed[0].guid == null && currentFeed[0] === "Invalid Date" && currentFeed[0].title != null) var feedId = currentFeed[x].title;
            else var feedId = currentFeed[x].guid;
            checkTable(currentFeed[x], feedId);
            filteredItems++;
          }
        }
      })
    }

    function checkTable(feed, data) {
      if (sendingTestMessage) {
        filteredItems++;
        gatherResults();
        sendToDiscord(rssIndex, channel, feed, true, function (err) {
          if (err) console.log(err);
        });
      }
      else {
        sqlCmds.select(con, feedName, data, function (err, results, fields) {
          if (err) {
            console.log(`RSS Error! (${guild.id}, ${guild.name}) => Error found at select table for feed ${feedName}, skipping...\n` + err);
            return callback(); // when a table doesn't exist, means it is a removed feed
          }
          if (!isEmptyObject(results)) {
            //console.log(`already seen ${feed.link}, not logging`);
            gatherResults();
          }
          else {
            sendToDiscord(rssIndex, channel, feed, false, function (err) {
              if (err) console.log(err);
            });
            insertIntoTable(data);
          }
        })
      }
    }


    function insertIntoTable(data) { //inserting the feed into the table marks it as "seen"
      sqlCmds.insert(con, feedName, data, function (err,res) {
        if (err) {
          console.log(`RSS Error! (${guild.id}, ${guild.name}) => Error found at insert to table for feed ${feedName}, skipping..\n` + err);
          return callback();
        }
        gatherResults();
      })
    }

    function gatherResults(){
      processedItems++;
      //console.log(`${rssList[rssIndex].name} ${filteredItems} ${processedItems}`) //for debugging
      if (processedItems == filteredItems) {
        callback();
      }
    }

    startDataProcessing();
  });
}
