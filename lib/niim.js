/**
 * @file        niim.js         Node Inspector IMproved
 *                              Library code which contains the lion's share of the changes
 *                              from the mainline node-inspect project.  Manages extra functions
 *                              on the communication with the attached process via niim_preload.js.
 * @author      Wes Garland, wes@kingsds.netwrok
 * @date        April 2020
 */
const process = require('process');
const fs = require('fs');
const net = require('net');
const child_process = require('child_process');
const debug = process.env.DEBUG_NIIM;

let debuggerState = { process: {}, child: {} };
var child; /**< handle to the attached process */

/**
 * Initialize a new process with niim.  Intercepts variables which are normally 
 * private to _inspect.js, sets up initial state caches, etc.
 *
 * @param    childHnd     {object}    The attached process, returned from spawn()
 * @param    niHnd        {object}    The instance of NodeInspector debugging the attached process
 */
exports.init = function niim$$init(childHnd, niHnd) {
  debuggerState.controlMessageLeftover = false;
  debuggerState.process = { stdin: [], stdout: [], stderr: [] };
  debuggerState.child   = { stdin: [], stdout: [], stderr: [], isRaw: false, isTTY: true };
  
  for (stream of ['stdin', 'stdout', 'stderr']) {
    debuggerState.child[stream].pending = [];
    debuggerState.child[stream].isRaw = false;
    debuggerState.child[stream].isTTY = true;
    debuggerState.process[stream].events = {};
    debuggerState.child[stream].events = {};
  }
  
  child = childHnd;
  ni = niHnd

  child.stderr.on('data', ni.childPrint.bind(ni));
  child.stdout.on('data', function niim$$stdoutHandler(text) {
    ni.childPrint(interceptMessages(text));
  });
  console.log("| niim: node-inspector improved - initialized");
}

/** Replacement for spawn which sets up the niim requirements for the
 *  child process, in particular, using the node -r option to load
 *  the niim_preload module into the debuggee when the passed command
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
    options.args = [ options.args[0], '-r', require.resolve('./niim_preload') ].concat(options.args.slice(1));

  let newProcess = child_process.spawn(command, options.args, options);
  var fd = fs.openSync("/tmp/crap", 'w+');
  fs.closeSync(fd);

  newProcess.stdio[0].fd = fd - 1;
  newProcess.stdio[1].fd = fd + 1;
  newProcess.stdio[2].fd = fd + 2;
  
  return newProcess;
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
  console.log('| entering interactive terminal mode');

  backupEvents(child.stdout, debuggerState.child.stdout.events);
  backupEvents(child.stderr, debuggerState.child.stderr.events);
  backupEvents(process.stdin, debuggerState.process.stdin.events);
  
  for (stream of ['stdin', 'stdout', 'stderr']) {
    /* Preserve raw mode and isTTY so they can be put back */
    debuggerState.process[stream].isRaw = process[stream].isRaw;
    debuggerState.process[stream].isTTY = process[stream].isTTY;
    if (process[stream].setRawMode)
      process[stream].setRawMode(debuggerState.child[stream].isRaw);
    process[stream].isTTY = debuggerState.child[stream].isTTY;

    /* Execute any tty state changes queued up from the attached process */
    while((pending = debuggerState.child[stream].pending.shift())) {
      pending();
    }
  }
}

/**
 * Restore the debugger's controlling TTY to the state it was in before enterITM().
 */
function exitITM() {
  for (stream of ['stdin', 'stdout', 'stderr']) {
    debuggerState.child[stream].isRaw = process[stream].isRaw;
    debuggerState.child[stream].isTTY = process[stream].isTTY;
    if (process[stream].setRawMode)
      process[stream].setRawMode(debuggerState.process[stream].isRaw);
    process[stream].isTTY = debuggerState.process[stream].isTTY;
  }

  restoreEvents(child.stdout, debuggerState.child.stdout.events);
  restoreEvents(child.stderr, debuggerState.child.stderr.events);
  restoreEvents(process.stdin, debuggerState.process.stdin.events);

  console.log('| exited interactive terminal mode');
}  

function typeInternals(charMode) {
  return new Promise(function (resolve, reject) {
    child.stdout.on("data", function niim$$type$childStdoutData(buf) {
      let tmp = interceptMessages(buf);
      process.stdout.write(Buffer.from(tmp));
    });

    child.stderr.on("data", function niim$$type$childStderrData(buf) {
      process.stderr.write(buf);
    });

    process.stdin.on("data", function niim$$type$process$stdinData(buf) {
      child.stdin.write(buf);
      if ((charMode && buf.indexOf(4) !== -1) || (!charMode && buf.indexOf(10) !== -1) || (!charMode && buf.indexOf(13) !== -1))
        resolve();
    });
  });
}

/** Debugger function: type on the local tty, but interact with the
 *  attached process instead of the debugger.
 */
exports.type = async function(charMode) {
  enterITM();

  try {
    await typeInternals(charMode);
  } finally {
    exitITM();
  }
}

/** Process messages coming from the attached process.
 *  Messages setting TTY modes etc will be buffered until we enter interactive
 *  terminal mode, to avoid interfering with the debugger REPL.
 */
function processMessage(message) {
  if (debug)
    console.log('| got control message:', message);

  switch(message.type) {
    case 'tty':
      let stream = message.which;
      debuggerState.child[stream].pending.push(function unwrapper() {
        process[stream][message.fn].apply(process[stream], message.arguments);
      });
    break;   
    default:
      console.error('! Received unrecognized message from attached process:', message);
  }
}

/** Edit the stdout stream from the attached process, intercepting
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

function backupEvents(eventEmitter, backup) {
  for (let eventName of eventEmitter.eventNames()) {
    backup[eventName] = [];
    for (let listener of eventEmitter.listeners(eventName)) {
      backup[eventName].push(listener);
      eventEmitter.off(eventName, listener);
    }
  }
}

function restoreEvents(eventEmitter, backup) {
  for (let eventName in backup) {
    for (let listener of backup[eventName]) {
      eventEmitter.on(eventName, listener);
    }
    delete backup[eventName];
  }
}

