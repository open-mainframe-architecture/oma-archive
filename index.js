"use strict";

const path = require('path');

const constants = require('oma-constants');
const jshint = require('jshint').JSHINT;
const util = require('oma-util');

const assetPath = {
  bootScript: util.filesPattern(constants.category, constants.module.bootScript),
  bundleScripts: util.filesPattern(constants.category, constants.archive.bundleScripts),
  classScripts: util.filesPattern(constants.category, constants.module.classScripts),
  configScript: util.filesPattern(constants.category, constants.module.configScript),
  configScripts: util.filesPattern(constants.category, constants.module.configScripts),
  publicAssets: util.filesPattern(constants.category, constants.module.publicAssets)
};

// promise to fill archive by scanning directories for modules
module.exports = (error, directories, output) => {
  const archive = util.zip(output);
  return Promise.all([
    // collect configure scripts
    collectConfigs(error, assetPath.bundleScripts, directories, archive),
    // collect source assets of modules
    collectModules(error, constants.archive.topConfig, directories, archive)
  ])
    .then(results => new Promise(function(resolve) {
      // resolve when archive can be reopened
      output.on('finish', () => { resolve(results[2]); });
      // close archive
      archive.end();
    }))
    ;
};

function collectConfigs(error, files, directories, archive) {
  const configs = {}, patterns = directories.map(dir => `${dir}/${files}`);
  return util.eachFile(patterns, file => {
    const dir = path.dirname(file.path);
    const relative = path.relative(path.dirname(dir), file.path).replace(util.seps, '/');
    if (configs[relative]) {
      throw new Error(`Duplicate configuration in archive: ${relative}`);
    }
    configs[relative] = file;
    util.zipFile(archive, relative, file);
  })
    .then(() => Promise.all(Object.keys(configs).map(relative =>
      verifyExpression(error, configs[relative])
    )))
    .then(util.doNothing)
    ;
}

function collectModules(error, files, directories, archive) {
  return collectTopModules(files, directories, archive)
    .then(modules => Promise.all(Object.keys(modules).map(name =>
      // recursively collect configure scripts of submodules
      collectSubModules(constants.archive.subConfig, archive, modules, name)))
      // configure scripts of all modules are now archived, continue with other assets
      .then(() => Promise.all(Object.keys(modules).map(name => Promise.all([
        verifyExpressions(error, assetPath.bootScript, modules[name]),
        archiveFiles(assetPath.bootScript, archive, name, modules[name]),
        verifyExpressions(error, assetPath.configScript, modules[name]),
        verifyExpressions(error, assetPath.configScripts, modules[name]),
        archiveFiles(assetPath.configScripts, archive, name, modules[name]),
        verifyExpressions(error, assetPath.classScripts, modules[name]),
        archiveFiles(assetPath.classScripts, archive, name, modules[name]),
        archiveFiles(assetPath.publicAssets, archive, name, modules[name])
      ]))))
      .then(() => Object.keys(modules).sort()))
    ;
}

function collectTopModules(files, directories, archive) {
  const modules = {};
  return util.eachFile(directories.map(dir => `${dir}/${files}`), file => {
    const dir = path.dirname(file.path), name = path.basename(dir);
    if (modules[name]) {
      throw new Error(`Duplicate module in archive: ${name}`);
    }
    modules[name] = dir;
    const relative = path.relative(path.dirname(dir), file.path).replace(util.seps, '/');
    util.zipFile(archive, relative, file);
  })
    .then(() => modules)
    ;
}

function collectSubModules(files, archive, modules, name) {
  return util.eachFile(`${modules[name]}/${files}`, file => {
    var dir = path.dirname(file.path), subName = name + '.' + path.basename(dir);
    if (modules[subName]) {
      throw new Error(`Duplicate module in archive: ${subName}`);
    }
    modules[subName] = dir;
    const relative = `${subName}/${path.relative(dir, file.path).replace(util.seps, '/')}`;
    util.zipFile(archive, relative, file);
    return collectSubModules(files, archive, modules, subName);
  });
}

function verifyExpression(error, file) {
  return Promise.resolve(error && util.readFileText(file).then(expressionSource => {
    jshint(`void\n${expressionSource}\n;`, constants.tool.jshint);
    for (let jsError of jshint.errors.slice()) {
      // adjust for extra first line
      error(`${file.path}:${jsError.line - 1}:${jsError.character}`, jsError.reason);
    }
  }));
}

function verifyExpressions(error, files, home) {
  return Promise.resolve(
    error && util.eachFile(`${home}/${files}`, file => verifyExpression(error, file))
  );
}

function archiveFiles(files, archive, name, home) {
  return util.eachFile(`${home}/${files}`, file => {
    const relative = `${name}/${path.relative(home, file.path).replace(util.seps, '/')}`;
    util.zipFile(archive, relative, file);
  });
}
