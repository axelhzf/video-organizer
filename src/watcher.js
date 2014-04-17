var organizer = require("./organizer");
var subtitlesDownloader = require("subtitles-downloader");
var _ = require("underscore");
var fs = require("fs");
var minimatch = require("minimatch");
var path = require("path");
var glob = require("glob");
var async = require("async");

var winston = require("winston");
var logger = winston.loggers.add('watcher', {
  console: {
    level: 'silly',
    colorize: 'true',
    //label: 'watcher',
    timestamp: true
  }
});


var GLOB = "*.+(mkv|avi|mp4)";
var SUBTITLES_RETRY_TIME = 1000 * 60 * 10; //every hour

function Watcher (basepath, destpath) {
  this.basepath = basepath;
  this.destpath = destpath;

  this.subtitlesQueue = async.queue(this.subtitlesWorker.bind(this));

  this.initWatcher();
  this.processBaseDirectory();
}

Watcher.prototype = {

  initWatcher: function () {
    var self = this;
    var watchedEvents = _.object(["change", "rename"], []);
    logger.info("Watching %s/%s -> %s", this.basepath, GLOB, this.destpath);

    fs.watch(this.basepath, function (event, filename) {
      if (_.has(watchedEvents, event)) {
        self.onFsEvent(event, filename);
      }
    });
  },

  onFsEvent: function (event, filename) {
    var self = this;
    var file = path.join(this.basepath, filename);
    fs.stat(file, function (err, stat) {
      if (err) return;
      if (stat.isDirectory()) {
        //avoid previews
        self.findBiggerFileInDirectory(file, function (err, biggerFile) {
          self.processFile(biggerFile);
        });
      } else {
        var match = minimatch(filename, GLOB);
        if (match) {
          self.processFile(file);
        }
      }
    });
  },

  findBiggerFileInDirectory: function (directory, cb) {
    glob(GLOB, {cwd: directory}, function (err, files) {
      async.mapSeries(files, function (filename, cb) {
        var file = path.join(directory, filename);
        fs.stat(file, function (err, stat) {
          cb(err, {file: file, stat: stat});
        });
      }, function (err, fileStats) {
        var biggerFile = _.max(fileStats, function (fileStat) {
          return fileStat.stat.size;
        });
        cb(null, biggerFile.file);
      });
    });
  },

  processFile: function (file, cb) {
    var self = this;
    organizer.move(file, this.destpath, function (err, movedFile) {
      if (movedFile) {
        logger.info("Moved %s -> %s", file, movedFile);
        self.subtitlesQueue.push({filepath: movedFile, language: "spa"});
        self.subtitlesQueue.push({filepath: movedFile, language: "eng"});
      }
      if (cb) cb(err);
    });
  },

  subtitlesWorker: function (subtitlesTask, cb) {
    var self = this;
    subtitlesDownloader.downloadSubtitle(subtitlesTask.filepath, subtitlesTask.language, function (err) {
      if (err) {
        logger.error(err);
        setTimeout(function () {
          self.subtitlesQueue.push(subtitlesTask);
        }, SUBTITLES_RETRY_TIME);
        cb();
      } else {
        logger.info("subtitles %s[%s]", subtitlesTask.filepath, subtitlesTask.language);
        cb();
      }
    });
  },

  processBaseDirectory: function () {
    var self = this;
    glob(GLOB, {cwd: this.basepath}, function (err, files) {
      files = files.map(function (file) {
        return path.join(self.basepath, file);
      });
      async.mapSeries(files, self.processFile.bind(self), function () {
        logger.info("Base directory updated %s", self.basepath);
      });
    });
  }

};

var watcher = function (basepath, destpath) {
  return new Watcher(basepath, destpath);
};

module.exports = watcher;