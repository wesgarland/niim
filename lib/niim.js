/**
 * @file        niim.js         Node Inspector IMproved
 *                              Library code which contains the lion's share of the changes
 *                              from the mainline node-inspect project.  Manages extra functions
 *                              on the communication with the attached process via niim-preload.js.
 *
 * @author      Wes Garland, wes@kingsds.netwrok
 * @date        April 2020
 */
"use strict";
const process = require('process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const niimUtil = require('./niim-util');
const child_process = require('child_process');
const debug = process.env.DEBUG_NIIM;
const { backupEvents, restoreEvents, overwriteArray } = niimUtil;
var debuggerState = { process: {}, child: {}, signals: {}, repl: {}, innerREPLHistory: [], outerREPLHistory: [] };
var child; /**< handle to the attached process */
var ni; /**< current NodeInspector */
var config; /**< niim config object */

/**
 * Initialize a new process with niim.  Intercepts variables which are normally 
 * private to _inspect.js, sets up initial state caches, etc.
 *
 * @param    childHnd     {object}    The attached process, returned from spawn()
 * @param    niHnd        {object}    The instance of NodeInspector debugging the attached process
 */
exports.init = function niim$$init(childHnd, niHnd) {
  if (child) {
    if (debug)
      console.log('| re-init; killing child');

    child.kill();
    try {
      child.stdin .end();
      child.stdout.end();
      child.stderr.end();
      process.kill(child.pid);
    } catch(e) {};
  }
    
  if (debuggerState.itm) {
    let p = debuggerState.itm; 
    delete debuggerState.itm;
    p.resolve().then(function() { exports.init.apply(null, arguments) });
    return;
  }
  
  debuggerState.controlMessageLeftover = false;
  debuggerState.process = { stdin: [], stdout: [], stderr: [] };
  debuggerState.child   = { stdin: [], stdout: [], stderr: [], isRaw: false, isTTY: true };
  
  for (let stream of ['stdin', 'stdout', 'stderr']) {
    debuggerState.child[stream].pending = [];
    debuggerState.child[stream].isRaw = false;
    debuggerState.child[stream].isTTY = true;
  }
  
  child = childHnd;
  ni = niHnd;
  config = ni.niimConfig;
  
  child.stderr.on('data', ni.childPrint.bind(ni));
  child.stdout.on('data', function niim$$stdoutHandler(text) {
    ni.childPrint(interceptMessages(text), true);
  });

  child.on('exit',      childCleanup); /* belt */
  child.on('close',     childCleanup); /* suspenders */

  process.on('SIGINT',  exitCleanup);
  process.on('SIGQUIT', exitCleanup);
  process.on('SIGHUP',  exitCleanup);
  process.on('exit',    exitCleanup);

  loadHistory();
  console.log(`| niim: Node-Inspector IMproved - initialized (${config.programName})`);
}

/** Initialize the debugging configure state (e.g. break on uncaught) */
exports.initDebugState = function niim$$initDebugState() {
  var doIt = require('./internal/inspect_repl')._friendEval;

  if (config.startup.breakOnUncaught)
    doIt("setPauseOnExceptions('uncaught')");
  
  delete process.traceProcessWarnings;
  process.traceProcessWarnings = true;
}

function exitCleanup() {
  if (debug)
    console.log('| exit cleanup', typeof child);
  
  exports.recordHistory();
  if (child)
    ni.killChild();
}

function childCleanup(code) {
  if (debug)
    console.log('| child cleanup', typeof child);
  
  try {
    ni.killChild();
    if (childCleanup.lastChild !== child.pid)
      console.log(`| child process ${child && child.pid} exited ${code && 'with code ' + code}`);
    childCleanup.lastChild = child.pid;
  } catch(e) {
    if (e.code !== 'ESRCH' && !config.compatDisconnect)
      console.log(e);
  }
}

/** Replacement for spawn which sets up the niim requirements for the
 *  child process, in particular, using the node -r option to load
 *  the niim-preload module into the debuggee when the passed command
 *  is process.execPath.
 */
exports.spawn = function niim$$spawn(command, args, options) {
  const stdioProps = [ 'isTTY', 'isRaw', 'rows', 'columns' ];
  var niimInfo = { stdin: {}, stdout: {}, stderr: {} }; /* initial state of debuggerInfo in niim-preload */

  stdioProps.filter((a) => typeof process.stdin[a]  !== 'undefined').forEach((a) => niimInfo.stdin[a]  = process.stdin[a]);
  stdioProps.filter((a) => typeof process.stdout[a] !== 'undefined').forEach((a) => niimInfo.stdout[a] = process.stdout[a]);
  stdioProps.filter((a) => typeof process.stderr[a] !== 'undefined').forEach((a) => niimInfo.stderr[a] = process.stderr[a]);

  if (!options && !Array.isArray(args)) {
    options = args;
    args = undefined;
  }
  if (!options)
    options = {};
  if (!options.args)
    options.args = args;
  options.env = Object.assign({NIIM: escape(JSON.stringify(niimInfo))}, process.env); /* communicate initial tty state via env */

  if (command === process.execPath)
    options.args = [ options.args[0], '-r', require.resolve('./niim-preload') ].concat(options.args.slice(1));

  return child_process.spawn(command, options.args, options);
}

/** Debugger function: send data to debuggee's stdin.
 *  @param  data  {string}   The data to send.
 */
exports.send = function niim$$send(data) {
  child.stdin.write(data);
}

/** Debugger function: send data from file to debuggee's stdin.
 *  @param  filename  {string}   The name of the file containing the data to send.
 */
exports.sendFile = function niim$$sendFile(filename) {
  var fd = fs.openSync(filename, 'r');
  var buf = Buffer.alloc(16384);
  var nRead;

  while ((nRead = fs.readSync(fd, buf, 0, buf.length))) {
    child.stdin.write(buf);
  }
}

/** Debugger function: send data from pipe to debuggee's stdin.
 *  @param    what   {number}     The file descriptor the pipe is on
 */
/** Debugger function: send data from pipe to debuggee's stdin.
 *  @param    what   {string}     Shell command whose output is the input to the pipeline
 */
exports.pipe = function niim$$pipe(what) {
  var stream;
  
  if (typeof what === 'number') {
    if (what < 3)
      throw new Error('pipe file descriptor must be > 2');
    stream = fs.createReadStream(null, { fd: what });
  } else {
    stream = child_process.exec(what).stdout;
  }

  stream.on("data", function niim$$pipe$onData(chunk) {
    child.stdin.write(chunk);
  });
  stream.on("close", function niim$$pipe$close() {
    child.stdin.end();
  });
}

/**
 * Enter Interactive Terminal Mode. Apply allow pending tty-type operations
 * to the local terminal, so that it has the same characteristeristics 
 * (especially raw mode) as the attached process believes its terminal has
 */
function enterITM() {
  var pendingFn;
  debuggerState.child.stdout.events  = backupEvents(child.stdout);
  debuggerState.child.stderr.events  = backupEvents(child.stderr);
  debuggerState.process.stdin.events = backupEvents(process.stdin);
//  debuggerState.process.replEvents   = backupEvents(ni.repl);
//  debuggerState.process.signalEvents = backupEvents(process, [ 'SIGINT' ]);
  
  for (let stream of ['stdin', 'stdout', 'stderr']) {
    /* Preserve raw mode and isTTY so they can be put back */
    debuggerState.process[stream].isRaw = process[stream].isRaw;
    debuggerState.process[stream].isTTY = process[stream].isTTY;
    if (process[stream].setRawMode)
      process[stream].setRawMode(debuggerState.child[stream].isRaw);
    process[stream].isTTY = debuggerState.child[stream].isTTY;

    /* Execute any tty state changes queued up from the attached process */
    while((pendingFn = debuggerState.child[stream].pending.shift())) {
      pendingFn();
    }
  }
}

/**
 * Restore the debugger's controlling TTY to the state it was in before enterITM().
 */
function exitITM() {
  for (let stream of ['stdin', 'stdout', 'stderr']) {
    debuggerState.child[stream].isRaw = process[stream].isRaw;
    debuggerState.child[stream].isTTY = process[stream].isTTY;
    if (process[stream].setRawMode)
      process[stream].setRawMode(debuggerState.process[stream].isRaw);
    process[stream].isTTY = debuggerState.process[stream].isTTY;
  }

  restoreEvents(debuggerState.child.stdout.events, child.stdout);
  restoreEvents(debuggerState.child.stderr.events, child.stderr);
  restoreEvents(debuggerState.process.stdin.events, process.stdin);
  restoreEvents(debuggerState.process.replEvents, ni.repl, ['SIGINIT']);
  restoreEvents(debuggerState.process.signalEvents, process);
}  

function typeInternals(quitChars) {
  var leftover = false;
  
  return new Promise(function (resolve, reject) {

    debuggerState.itm = { resolve, reject };

    if (!process.stdin.isRaw) {
      function sigintHandler() {
        process.off('SIGINT', sigintHandler);
        resolve();
      }
      process.on('SIGINT', sigintHandler);
    }
    
    child.stdout.on("data", function niim$$type$childStdoutData(buf) {
      let tmp = interceptMessages(buf);
      process.stdout.write(Buffer.from(tmp));
    });

    child.stderr.on("data", function niim$$type$childStderrData(buf) {
      process.stderr.write(buf);
    });

    process.stdin.on("data", function niim$$type$process$stdinData(buf, timerExpired) {

      if (leftover) {
        let newBuf = Buffer.allocUnsafe(buf.length + leftover.length);
        leftover.copy(newBuf);
        buf.copy(newBuf, leftover.length);
        buf = newBuf;
        leftover = false;
      }
      
      if (quitChars) {
        let idx = buf.indexOf(quitChars);

        if (idx !== -1) { /* complete quit char sequence */
          child.stdin.write(buf.slice(0, idx));
          buf = Buffer.concat([buf.slice(idx + quitChars.length), leftover || Buffer.alloc(0)]);
          resolve(buf);
          return;
        }

        if (!timerExpired) {
          idx = buf.lastIndexOf(quitChars[0]); /* partial quit char sequence */
          if (idx + quitChars.length > buf.length) {
            leftover = buf.slice(idx);
            buf = buf.slice(0, idx);
            setTimeout(() => niim$$type$process$stdinData(Buffer.alloc(0), true), 500);
          }
        }
      }

      child.stdin.write(buf);
    });
  });
}

/** Debugger function: type on the local tty, but interact with the
 *  attached process instead of the debugger.
 */
exports.startPassthroughTTY = async function niim$$startPassthroughTTY() {
  var leftover;
  let quitChars, quitHow;

  if (debuggerState.itm) {
    if (debug)
      console.log('| already in interactive terminal mode');
    return;
  }
  
  enterITM();
  try {
    if (process.stdin.isRaw) {
      quitChars = Buffer.from(config.itmExitSequence, "utf8");
      quitHow = niimUtil.printable(quitChars);
    } else {
      quitHow = 'SIGINT';
    }

    setImmediate(function() {
      process.stdout.clearLine(0);
      console.log('\r< entering interactive terminal mode,', quitHow, 'to exit', `(${config.prompt})`);
    });
    let leftover = await typeInternals(quitChars);
  } catch(e) {
    console.error('| exited interactive terminal mode due to error', e);
  } finally {
    delete debuggerState.itm;
    exitITM();
    console.log('\n| exited interactive terminal mode');
    if (leftover)
      child.stdout.emit('data', leftover);
  }
}

/** Process messages coming from the attached process.
 *  Messages setting TTY modes etc will be buffered until we enter interactive
 *  terminal mode, to avoid interfering with the debugger REPL.
 */
async function processMessage(message) {
  if (debug)
    console.log('| got control message:', message);

  switch(message.type) {
    case 'tty': {  
      let stream = message.which;
      debuggerState.child[stream].pending.push(function unwrapper() {
        if (process[stream] && process[stream][message.fn])
          process[stream][message.fn].apply(process[stream], message.arguments);
        else
          console.error(`No such function: process.${stream}.${message.fn}`);
      })
      if (config.autoRawITM && message.which === 'stdin' && message.fn === 'setRawMode') {
        let value = !!message.arguments[0];    
        if (value) {
          exports.startPassthroughTTY();
          debuggerState.itm.autoRawStarted = true;
        }
        else if (debuggerState.itm && debuggerState.itm.autoRawStarted)
          debuggerState.itm.resolve();
      }
    }
    break;   
    case 'itm': {
      if (message.arg)
        exports.startPassthroughTTY();
      else {
        if (debuggerState.itm)
          debuggerState.itm.resolve();
      }
    }
    break;
    default:
      console.error('! Received unrecognized message from attached process:', message);
      debugger;
  }
}

/** Edit the stdout stream from the attached process, interepting
 *  embedded messages and unescaping NULs on the way through. All
 *  message fragments from the child much reach this function, in order.
 *
 *  @param    text   {string or Buffer}    Message fragment from child's stdout
 *  @return   string of text that the attached process sent to stdout, devoid
 *            of control messages.
 */
function interceptMessages(text) {
  let match;
  let nulNulRE = new RegExp('\x00\x00', 'g');
  let nulJsonNulRE = new RegExp('\x00[^\x00]+\x00', 'g');
  let brokenRE = new RegExp('[^\x00]\x00[^\x00]*$');
  if (typeof text !== 'string')
    text = text.toString();

  if (debuggerState.controlMessageLeftover) {
    text = debuggerState.controlMessageLeftover + text;
    delete debuggerState.controlMessageLeftover;
  }

  /* Remove complete messages */
  while ((match = nulJsonNulRE.exec(text))) {
    let json = text.slice(match.index + 1, match.index + match[0].length - 1);
    try {
      let jsonO = JSON.parse(json);
      processMessage(jsonO);
    } catch(e) {
      console.error(`| error processing message '${json}'`);
    }
    text = text.slice(0, match.index) + text.slice(match.index + match[0].length);
   }

  /* Store partial message */
  match = brokenRE.exec(text);
  if (match) {
    debuggerState.controlMessageLeftover = text.slice(match.index + 1);
    text = text.slice(0, match.index + 1);
  }
  
  /* Collapse NUL NUL into NUL */
  text = text.replace(nulNulRE, '\x00');
  return text;
}

function makeHistoryFilename() {
  if (!config.history && !process.env.NIIM_REPL_HISTORY)
    return false;

  return (process.env.NIIM_REPL_HISTORY || config.history)
    .replace(new RegExp('^~' + path.sep), os.homedir() + path.sep)
    .replace(new RegExp('^~'), path.resolve(os.homedir(), '..') + path.sep);
}

/**
 * Record the history file.  Both REPLs' history are recorded simultaneously. The
 * outer REPL's history is aggregated with the history for all niim sessions.  The
 * inner REPL's history is aggregated with the history from other programs with 
 * the same name.  All history from all programs and the outer REPL are stored in
 * a single file. The history file size configuration parameter limits the size of
 * an individual REPL's storage in this file, and not the overall file size.
 *
 * @param    repl   {object}     If specified, this is the inner REPL.
 */
exports.recordHistory = function nimm$recordHistory(repl) {
  const blankHistory = { outer: [], inner: {} };
  var fd, buf;
  var history;
  var maxLength = process.env.NIIM_REPL_HISTORY_SIZE ? parseInt(process.env.NIIM_REPL_HISTORY_SIZE, 10) : config.historySize;
  var filename = makeHistoryFilename();
  var newFilename = filename + '.' + process.pid;
  
  if (!filename)
    return;
  if (!config.insecurePaths) {
    let securePath = path.resolve(os.homedir(), '.niim') + path.sep;
    if (filename.slice(0, securePath.length) !== securePath) {
      console.error('| Cowardly refusing to write history in', filename);
      return;
    }
  }
  if (debuggerState.innerREPLHistory.length === debuggerState.outerREPLHistory.length === 0)
    return;

  fs.mkdirSync(path.dirname(filename), { recursive: true });
  try {
    fd = fs.openSync(filename, 'r+');
    buf = Buffer.alloc(fs.fstatSync(fd).size);
    if (buf.length) {
      fs.readSync(fd, buf, 0, buf.length, 0);
      try {
        history = JSON.parse(buf.toString('utf8'));
      } catch(e) {
        console.error(`Error: corrupt history file '${filename}'`);
        console.log(buf.toString('utf8'));
      }
    }
  } catch(e) {
    if (e.code !== 'ENOENT') {
      console.warn(e);
      throw e;
    }
  } finally {
    if (fd)
      fs.closeSync(fd);
  }

  if (!history)
    history = {};
  if (!history.inner)
    history.inner = {};
  
  fd = fs.openSync(newFilename, 'w+');
  try {
    history.outer = debuggerState.outerREPLHistory.slice(0, maxLength);
    history.inner[config.programName] = debuggerState.innerREPLHistory.slice(0, maxLength);
    buf = Buffer.from(JSON.stringify(history), "utf8");
    fs.writeSync(fd, buf, 0, buf.length, 0);
    fs.renameSync(newFilename, filename);
  } finally {
    fs.closeSync(fd);
    fs.unlink(newFilename, () => true);
  }
}

exports.syncHistory = function niim$$syncHistory(outer, inner) {
  if (debuggerState.outerREPLHistory.length === 0 && debuggerState.innerREPLHistory.length === 0)
    loadHistory();

  if (outer && debuggerState.outerREPLHistory !== outer) {
    debuggerState.outerREPLHistory.forEach((line) => outer.push(line))
    debuggerState.outerREPLHistory = outer;
  }

  if (inner && debuggerState.innerREPLHistory !== inner) {
    debuggerState.innerREPLHistory.forEach((line) => inner.push(line))
    debuggerState.innerREPLHistory = inner;
  }
}

/** Load the history from disk
 */
function loadHistory() {
  var filename = makeHistoryFilename();
  var fd, buf;
  var history;

  if (!filename)
    return;

  try {
    history = {};
    fd = fs.openSync(filename, 'r');
    buf = Buffer.alloc(fs.fstatSync(fd).size);
    if (buf.length) {
      try {
        fs.readSync(fd, buf, 0, buf.length, 0);
      } finally {
        fs.closeSync(fd);
      }
      try {
        history = JSON.parse(buf.toString('utf8'));
      } catch(e) {
        console.error(`Error: corrupt history file '${filename}'`);
        console.log(buf.toString('utf8'));
      }
    }
  } catch(e) {
    if (e.code !== 'ENOENT') {
      console.warn('Warning reading history file:', e);
      throw e;
    }
  }
  
  if (!history)
    history = {};
  if (!history.outer)
    history.outer = [];
  if (!history.inner)
    history.inner = {};
  if (!history.inner[config.programName])
    history.inner[config.programName] = [];

  overwriteArray(debuggerState.outerREPLHistory, history.outer);
  overwriteArray(debuggerState.innerREPLHistory, history.inner[config.programName]);
}

exports.interceptCallMethodError = function niim$$interceptCallMethodError(error, result, data) {

  if (data.method === 'Debugger.resume' && error.code === -32000 && error.message === 'Can only perform operation while paused.') {
    console.error('|', error.message);
    return false;
  }

  return error;
}
