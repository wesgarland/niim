const process = require('process');
const fs = require('fs');
const child_process = require('child_process');
const debug = true || process.env.NIIM_DEBUG;
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

  return child_process.spawn(command, options.args, options);
}

/**
 * Initialize a new process with niim.  Intercepts variables which are normally 
 * private to _inspect.js.
 *
 * @param    childHnd       {object}      The attached process, returned from spawn()
 * @param    stdoutHandler  {function}    The event listener currently attached to
 *                                        childHnd.on("data").
 */
exports.init = function niim$$init(childHnd, stdoutHandler) {
  debuggerState = { isRaw: process.stdin.isRaw };
  debuggeeState = {};
  
  child = childHnd;
  child.stdout.removeListener('data', stdoutHandler);
  child.stdout.on('data', function niim$$stdoutHandler(text) {
    stdoutHandler.call(child.stdout, interceptMessages(text));
  }.bind(child.stdout));
  console.log("| niim: node-inspector improved - initialized");
}

exports.send = function niim$$send(data) {
  child.stdin.write(data);
}

exports.sendFile = function niim$$sendFile(filename) {
  var fd = openSync(filename, 'r');
  var buf = Buffer.alloc(16384);
  var nRead;

  while ((nRead = fs.readSync(fd, buf, 0, buf.length))) {
    child.stdin.write(buf);
  }
}

exports.type = function num$$type(bufSize) {
  let leftover = false;
  var chBuf = Buffer.alloc(parseInt(bufSize, 10) || 1);
  var buf = '';
 
  debuggerState.isRaw = process.stdin.isRaw;
  if (typeof debuggeeState.isRaw !== 'undefined') {
    process.stdin.setRawMode(debuggeeState.isRaw);
    if (debug)
      console.log('| set raw mode=', process.stdin.isRaw);
  }
  try {
    while(true) {
      let ch;
      try {
        if (!leftover) {
          nRead = fs.readSync(process.stdin.fd, chBuf, 0, chBuf.length);
        } else {
          leftover.copy(chBuf);
          nRead = leftover.length;
          leftover = false;
        }
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

      if (nRead < 0)
        return null /* input stream is closed */
      if (nRead == 0) { /* nothing to read - give up timeslice */
        msleep(63);
        continue;
      }
      for (let pos=0; pos < nRead; pos++) {
        ch = chBuf[pos];

        switch(ch) {
        case 3:
          process.kill(child.pid, 'SIGINT');
          continue;
        case 8: case 127:
          buf = buf.slice(0,-1);
          if (echoChar)
            process.stdout.write(Buffer.from([8,32,32,8,8]));
          continue;
        case 4:
          if (buf.length)
            break;
        case 10: case 13:
          if (nRead - pos != 0) {
            leftover = chBuf.slice(pos + 1)
          }
          return buf;
        case 28:
          process.kill(child.pid, 'SIGQUIT');
          continue;
        case 21:
          for (let i=0; i < buf.length; i++) {
            if (buf.charCodeAt(i) >= 0xd800 && buf.charCodeAt(i) < 0xdc00)
              continue;
            process.stdout.write(Buffer.from([8,32,8]));
          }
          buf = '';
          continue;
        }
        child.stdin.write(Buffer.from([ch]));
      }
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

function interceptMessages(text) {
  let match;
  let nulNulRE = new RegExp('\x00\x00', 'g');
  let nulJsonNulRE = new RegExp('\x00[^\x00]+\x00', 'g');
  if (typeof text !== 'string')
    text = text.toString();

  while ((match = nulJsonNulRE.exec(text))) {
    let json = text.slice(match.index + 1, match.index + match[0].length - 1);
    processMessage(JSON.parse(json));
    text = text.slice(0, match.index) + text.slice(match.index + match[0].length);
  }

  return text.replace(nulNulRE, '\x00');
}

function msleep(ms) {
  let sab = new SharedArrayBuffer(4);
  let int32 = new Int32Array(sab);
  Atomics.wait(int32, 0, 0, ms);
}

