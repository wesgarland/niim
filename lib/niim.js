/**
 * @file        niim.js         Node Inspector IMproved
 *                              Library code which contains the lion's share of the changes
 *                              from the mainline node-inspect project.  Manages extra functions
 *                              on the communication with the attached process via niim-preload.js.
 * @author      Wes Garland, wes@kingsds.netwrok
 * @date        April 2020
 */
"use strict";
const process = require('process');
const fs = require('fs');
const net = require('net');
const niimUtil = require('./niim-util');
const child_process = require('child_process');
const debug = process.env.DEBUG_NIIM;
const { backupEvents, restoreEvents } = niimUtil;
var debuggerState = { process: {}, child: {}, signals: {}, repl: {} };
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
  if (debuggerState.itmPromise) {
    let p = debuggerState.itmPromise; 
    delete debuggerState.itmPromise;
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
    ni.childPrint(interceptMessages(text));
  });
  console.log("| niim: Node-Inspector IMproved - initialized");
}

/** Replacement for spawn which sets up the niim requirements for the
 *  child process, in particular, using the node -r option to load
 *  the niim-preload module into the debuggee when the passed command
 *  is process.execPath.
 */
exports.spawn = function niim$$spawn(command, args, options) {
  var niimInfo = {
    isTTY: process.stdin.isTTY
  };
  
  if (!options && !Array.isArray(args)) {
    options = args;
    args = undefined;
  }
  if (!options)
    options = {};
  if (!options.args)
    options.args = args;
  options.env = Object.assign({NIIM: escape(JSON.stringify(niimInfo))}, process.env);

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

/** Debugger function: send data to debuggee's stdin.
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
  let leftover = false;
  
  return new Promise(function (resolve, reject) {

    debuggerState.itmPromise = { resolve, reject };

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

    process.stdin.on("data", function niim$$type$process$stdinData(buf) {
      if (leftover) {
        buf = leftover.concat(buf);
        leftover = false;
      }
      
      if (quitChars) {
        let idx = buf.indexOf(quitChars);

        if (idx !== -1) {
          child.stdin.write(buf.slice(0, idx + quitChars.length));
          buf = Buffer.concat([buf.slice(idx + quitChars.length), leftover || Buffer.from([])]);
          resolve(buf);
          return;
        }
        idx = buf.lastIndexOf(quitChars[0]);
        if (idx + quitChars.length > buf.length) {
          leftover = buf.slice(idx);
          buf = buf.slice(0, idx);
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

  if (debuggerState.itmPromise) {
    console.log('| error - already in interactive terminal mode');
    return; /* already in this state */
  }
  
  enterITM();
  try {
    if (process.stdin.isRaw) {
      quitChars = Buffer.from([3]);
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
    delete debuggerState.itmPromise;
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
        process[stream][message.fn].apply(process[stream], message.arguments);
      })
      if (config.autoRawITM && message.which === 'stdin' && message.fn === 'setRawMode') {
        let value = !!message.arguments[0];    
        if (value)
          exports.startPassthroughTTY();
        else if (debuggerState.itmPromise) 
          debuggerState.itmPromise.resolve();
      }
    }
    break;   
    default:
      console.error('! Received unrecognized message from attached process:', message);
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
    processMessage(JSON.parse(json));
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
