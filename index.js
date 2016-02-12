"use strict";

var path = require('path');

var constants = require('oma-constants');
var jshint = require('jshint').JSHINT;
var util = require('oma-util');

var assetPath = {
  bootScript: util.filesPattern(constants.category, constants.module.bootScript),
  bundleScripts: util.filesPattern(constants.category, constants.archive.bundleScripts),
  classScripts: util.filesPattern(constants.category, constants.module.classScripts),
  configScript: util.filesPattern(constants.category, constants.module.configScript),
  configScripts: util.filesPattern(constants.category, constants.module.configScripts),
  publicAssets: util.filesPattern(constants.category, constants.module.publicAssets)
};

// promise to fill archive by scanning directories for modules
module.exports = function (error, directories, output) {
  var archive = util.zip(output);
  return Promise.all([
    // collect configure scripts
    collectConfigs(error, assetPath.bundleScripts, directories, archive),
    // collect source assets of modules
    collectModules(error, constants.archive.topConfig, directories, archive)
  ])
    .then(function (results) {
      return new Promise(function (resolve) {
        // resolve when archive can be reopened
        output.on('finish', function() { resolve(results[2]); });
        // close archive
        archive.end();
      });
    })
    ;
};

function collectConfigs(error, files, directories, archive) {
  var configs = {}, patterns = directories.map(function (dir) { return dir + '/' + files; });
  return util.mapFiles(patterns, function (file, cb) {
    var dir = path.dirname(file.path);
    var relative = path.relative(path.dirname(dir), file.path).replace(util.seps, '/');
    if (configs[relative]) {
      throw new Error('Duplicate configuration in archive:' + relative);
    }
    configs[relative] = file;
    util.zipFile(archive, relative, file);
    cb(null);
  })
    .then(function () {
      return Promise.all(Object.keys(configs).map(function (relative) {
        return verifyExpression(error, configs[relative]);
      }));
    })
    .then(function () { })
    ;
}

function collectModules(error, files, directories, archive) {
  return collectTopModules(files, directories, archive)
    .then(function (modules) {
      return Promise.all(Object.keys(modules).map(function (name) {
        // recursively collect configure scripts of submodules
        return collectSubModules(constants.archive.subConfig, archive, modules, name);
      }))
        .then(function () {
          // configure scripts of all modules are now archived, continue with other assets
          var names = Object.keys(modules);
          return Promise.all(names.map(function (name) {
            var home = modules[name];
            return Promise.all([
              verifyExpressions(error, assetPath.bootScript, home),
              verifyExpressions(error, assetPath.configScript, home),
              verifyExpressions(error, assetPath.configScripts, home),
              verifyExpressions(error, assetPath.classScripts, home),
              archiveFiles(assetPath.bootScript, archive, name, home),
              archiveFiles(assetPath.configScripts, archive, name, home),
              archiveFiles(assetPath.classScripts, archive, name, home),
              archiveFiles(assetPath.publicAssets, archive, name, home)
            ]);
          }))
            .then(function () { return names.sort(); })
            ;
        });
    })
}

function collectTopModules(files, directories, archive) {
  var modules = {};
  var patterns = directories.map(function (dir) { return dir + '/' + files; });
  return util.mapFiles(patterns, function (file, cb) {
    var dir = path.dirname(file.path), name = path.basename(dir);
    if (modules[name]) {
      throw new Error('Duplicate module in archive: ' + name);
    }
    modules[name] = dir;
    var relative = path.relative(path.dirname(dir), file.path).replace(util.seps, '/');
    util.zipFile(archive, relative, file);
    cb(null);
  })
    .then(function () { return modules; })
    ;
}

function collectSubModules(files, archive, modules, name) {
  return util.mapFiles(modules[name] + '/' + files, function (file, cb) {
    var dir = path.dirname(file.path), subName = name + '.' + path.basename(dir);
    if (modules[subName]) {
      throw new Error('Duplicate module in archive: ' + subName);
    }
    modules[subName] = dir;
    var relative = subName + '/' + path.relative(dir, file.path).replace(util.seps, '/');
    util.zipFile(archive, relative, file);
    collectSubModules(archive, modules, subName).then(function () { cb(null); });
  });
}

function verifyExpression(error, file) {
  return error && util.readFileText(file)
    .then(function (expressionSource) {
      jshint('void\n' + expressionSource + '\n;', constants.tool.jshint);
      jshint.errors.slice().forEach(function (jsError) {
        // adjust for extra first line
        error(file.path + ':' + (jsError.line - 1) + ':' + jsError.character, jsError.reason);
      });
    });
}

function verifyExpressions(error, files, home) {
  return error && util.mapFiles(home + '/' + files, function (file, cb) {
    verifyExpression(error, file)
      .then(function () { cb(null); })
    ;
  });
}

function archiveFiles(files, archive, name, home) {
  return util.mapFiles(home + '/' + files, function (file, cb) {
    var relative = name + '/' + path.relative(home, file.path).replace(util.seps, '/');
    util.zipFile(archive, relative, file);
    cb(null);
  });
}
