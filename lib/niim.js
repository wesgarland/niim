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
const debug = process.env.NIIM_DEBUG;
var child;
var debuggeeState;
var debuggerState;

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

/**
 * Initialize a new process with niim.  Intercepts variables which are normally 
 * private to _inspect.js.
 *
 * @param    childHnd     {object}    The attached process, returned from spawn()
 * @param    niHnd        {object}    The instance of NodeInspector debugging the attached process
 */
exports.init = function niim$$init(childHnd, niHnd) {
  debuggerState = { isRaw: process.stdin.isRaw };
  debuggeeState = {};

  child = childHnd;
  ni = niHnd
  debugger;
  child.stderr.on('data', ni.childPrint.bind(ni));
  child.stdout.on('data', function niim$$stdoutHandler(text) {
    ni.childPrint(interceptMessages(text));
  });
  console.log("| niim: node-inspector improved - initialized");
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

function read(stream, buf) {
  if (stream === child.stdout)
    stream.fd = 23;
  if (stream === child.stderr)
    stream.fd = 25;
  
  if (!stream.hasOwnProperty('fd')) {
    let chunk = stream.read(buf.length);
    if (chunk === null)
      return 0;
    return chunk.copy(buf);
  }

  try {
    nRead = fs.readSync(stream.fd, buf, 0, buf.length);
  } catch (e) {
    switch(e.code) {
    case 'EAGAIN':
      nRead = 0
      break
    case 'EOF':
      nRead = -1
      break
    default:
      throw e
    }
  }

  return nRead;
}

/** Debugger function: type on the local tty, but interact with the
 *  attached process instead of the debugger.
 */
exports.type = function num$$type(linemode) {
  var chBuf = Buffer.alloc(1);
  var ioBuf = Buffer.alloc(10240);
  var tmp, tmpBuf;

  var lineBuf = '';

  debuggerState.isRaw = process.stdin.isRaw;
  try {
    if (typeof debuggeeState.isRaw !== 'undefined') {
      process.stdin.setRawMode(debuggeeState.isRaw);
      if (debug)
        console.log('| set raw mode=', process.stdin.isRaw);
    }
    exports.child = child;

    while(true) {
      /* Read from attached process' stdout/stderr and route to our own */
      nRead = read(child.stdout, ioBuf);
      if (nRead < 0)
        break;
      tmp = interceptMessages(ioBuf.slice(0, nRead));
      process.stdout.write(Buffer.from(tmp));
      nRead = read(child.stderr, ioBuf);
      if (nRead < 0)
        break;
      process.stderr.write(ioBuf.slice(0, nRead));
      
      /* Read from our stdin and route to attached process' stdin */
      nRead = read(process.stdin, chBuf);
      if (nRead < 0)
        return null /* input stream is closed */

      if (nRead === 0) { /* nothing to read - give up timeslice */
        msleep(125/2);
        continue;
      }
      if (chBuf[0] == 3)
        break;
      child.stdin.write(chBuf);
    }
  } finally {
    process.stdin.setRawMode(debuggerState.isRaw);
  }
}

function processMessage(message) {
  if (debug)
    console.log('| got control message:', message);
  switch(message.type) {
  case 'rawMode':
    debuggeeState.isRaw = message.value;
    break;
  default:
    console.error('Received unrecognized message from attached process:', message);
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

  if (debuggeeState.controlMessageLeftover) {
    text = debuggeeState.controlMessageLeftover + text;
    delete debuggeeState.controlMessageLeftover;
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
    debuggeeState.controlMessageLeftover = text.slice(match.index + 1);
    text = text.slice(0, match.index + 1);
  }
  
  /* Collapse NUL NUL into NUL */
  text = text.replace(nulNulRE, '\x00');
  return text;
}

function msleep(ms) {
  let sab = new SharedArrayBuffer(4);
  let int32 = new Int32Array(sab);
  Atomics.wait(int32, 0, 0, ms);
}

