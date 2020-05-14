/**
 * @file        niim-config.js  Config file processing for niim.
 *                              Files are JavaScript, not JSON, and must either evaluate to an
 *                              object, or be a series of statements which modify the configuration
 *                              object. Evaluation happens inside an isolated context with a few
 *                              node staples from process and os patched in from the calling
 *                              environment. The configuration object is named 'niim' in this context.
 *
 *                              Multiple config files are read in; any property set in the config
 *                              object by the latest file takes precedence. Config files are read
 *                              in the following order:
 *                              - etc/niim.config
 *                              - etc/your-program-name.config
 *                              - ~/.niim/config
 *                              - ~/.niim/your-program-name.config
 *                              - filename passed with --config=
 *
 * @author      Wes Garland, wes@kingsds.netwrok
 * @date        April 2020
 */
"use strict";

const path = require('path');
const fs = require('fs');
const vm = require('vm');
const os = require('os');
const debug = process.env.DEBUG_NIIM_CONFIG;

/** Evaluate a config file in a sandbox without polluting the global object.
 *  @param      filename        {string}    The name of the file to evaluate
 *  @param      sandbox         {object}    A sandbox object, the config script's "global object"
 */
function evalScriptInSandbox(filename, sandbox) {
  var code;
  var snapshot;
  var ret;
  var objMode;

  if (!filename)
    return;
  
  try {
    if (debug)
      console.log(`| nimm - loading config ${filename}`);
    code = fs.readFileSync(filename, 'utf8');
  } catch(e) {
    if (e.code === 'ENOENT')
      return;
    console.error('evalScriptInSandbox Error:', e.message);
    throw e;
  }

  /* Remove opening C-style comments */
  while (code.match(/^[\n\r\t ]*\/\*/)) {
    let i = code.indexOf('*/');
    code = code.slice(i + 2);
  };
  /* Remove opening C++-style comments */
  while (code.match(/^[\n\r\t ]*\/\//)) {
    let i = code.indexOf('\n');
    code = code.slice(i + 1);
  }
              
  /* Detect whether this is an object literal or a series of assignments */
  if (code.match(/^[ \t\r\n]*{/)) {
    code = '(' + code + ')';
    objMode = true;
  } else {
    snapshot = JSON.stringify(sandbox.niim);
  }
        
  ret = require('vm').runInContext(code, sandbox, filename, 0); // eslint-disable-line
  if (!objMode) {
    if (snapshot == JSON.stringify(sandbox.niim) && !code.match(/\/\/ suppress snapshot warning *(\n|\r|$)/))
      console.warn(`Warning: niim config file ${filename} did not modify the running config`);
    return;
  }
  if (typeof ret !== 'object')
    throw new Error(`niim config file ${filename} started with { but did not evaluate to an object!`);
  Object.assign(sandbox.niim, ret);
}

function configResolve(filename) {
  var re, match;
  
  if (!filename)
    return filename;

  if (path.isAbsolute(filename))
    return filename;

  if (filename.startsWith('~' + path.sep))
    return path.resolve(os.homedir(), filename.slice(2));

  re = new RegExp(`~([^${path.sep}]+)${path.sep}(.*)`);
  if ((match = re.exec(filename))) {
    let user = match[1];
    let rest = match[2];

    return path.resolve(os.homedir(), '..', user, rest);
  }
  
  if (filename.startsWith('.' + path.sep) || filename.startsWith('..' + path.sep))
    return path.resolve(process.cwd(), filename);
  
  return path.resolve(os.homedir(), '.niim', filename);
}

/** 
 * Initialize (read) the niim configuration.
 * @param    debuggeeFilename    {string}       The name of the program which is being debugged
 * @param    niimOptions         {object}       --niim- command-line options passed to the main program
 * @returns  the configuration object
 */
exports.init = function niimConfig$$init(debuggeeFilename, niimOptions) {
  var config = {};
  var sandbox = {
    console: {
      log:   console.log,
      error: console.error,
      debug: console.debug,
      warn:  console.warn,
    },
    process: {
      env:      [].concat(process.env),
      arch:     process.arch,
      platform: process.platform
    },
    os: {
      EOL:      os.EOL,
      tmpDir:   os.tmpDir,
      homedir:  os.homedir,
      hostname: os.hostname,
      platform: os.platform,
      release:  os.release,
      arch:     os.arch,
      cpus:     os.cpus,
      type:     os.type,
    },
    niim: config
  }
  var prog = path.basename(debuggeeFilename, '.js');
  var etc = path.join(path.dirname(module.filename), '..', 'etc');
  var flist = [
    path.resolve(etc, 'config'),
    path.resolve(etc, prog + '.config'),
    path.resolve(os.homedir(), '.niim', 'config'),
    path.resolve(os.homedir(), '.niim', prog + '.config'),
    configResolve(niimOptions.config),
    configResolve(process.env.NIIM_CONFIG_FILE)
  ];

  sandbox.programName = prog;
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  require('vm').createContext(sandbox);
  
  for (let filename of flist) {
    evalScriptInSandbox(filename, sandbox);
  }

  config.programName = prog;
  if (debug)
    console.log(`| nimm - final config is`, config);

  return exports.config = config;
}
