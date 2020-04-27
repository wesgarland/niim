/**
 * @file       niim_preload.js          Module which is included via the `node -r` facility when launching
 *                                      a node program that is going to be attached to with niim.  This
 *                                      module sets up the plumbing for debuggee's control code to communicate
 *                                      with the debugger, so that facilities like tty raw mode can be
 *                                      negotiated over the socketpair that is established by the spawn.
 * @author     Wes Garland, wes@kingsds.network
 * @date       April 2020
 */

/* later: implement two-way control.  Send parent stdin columns, row, WINCH over extra 4th socket. keep stdout escape to preserve I/O vs message ordering */
/* then the wrapper factory learns the difference between functions and procedures and can ask for return values over the protocol.  Use blocking read of control socket for sync? */

const process = require('process');
const realStdin = process.stdin;
const realStdout = process.stdout;
const stdoutWrite = process.stdout.write.bind(process.stdout);
const stdout_Write = process.stdout._write.bind(process.stdout);
const debuggerInfo = Object.assign(JSON.parse(unescape(process.env.NIIM) || {}), {isRaw: false});
const NUL = Buffer.from([0]);
const NULNUL = Buffer.from([0,0]);
const stdinPatches = { set: {}, get: {}, fn: {}, label: 'stdin' };
const stdoutPatches = { set: {}, get: {}, fn: {}, label: 'stdin' };
const debug = process.env.DEBUG_NIIM_PRELOAD;

/** 
 * Factory function which returns function wrappers. 
 * Each wrapper knows how to send a message back to the debugger asking it to do whatever
 * the wrapped function would normally to do the controlling TTY.
 *
 * @param   label   {string}     The control message protocol label for the function group
 * @param   fn      {function}   The name of the function to wrap
 */
function WrapperFactory(label, fn) {
  return function niim_preload$$wrapper() {
    sendMessage({type: 'tty', which: label, fn: fn, arguments: Array.from(arguments)})
  };
}

stdinPatches.fn.setRawMode = function niim_preload$$stdin$set_RawMode(arg) {
  debuggerInfo.isRaw = arg;

  if (!stdinPatches.fn.setRawMode._impl)
    stdinPatches.fn.setRawMode._impl = WrapperFactory('stdin', 'setRawMode');
  stdinPatches.fn.setRawMode._impl.apply(null, arguments);
}

stdinPatches.get.isRaw = function niim_preload$$stdin$get_isRaw() {
  return debuggerInfo.isRaw;
}

stdinPatches.get.isTTY = function niim_preload$$stdin$get_isTTY() {
  return debuggerInfo.isTTY;
}

stdinPatches.set.isTTY = function niim_preload$$stdin$set_isTTY(value) {
  debuggerInfo.isTTY = value;
}

stdoutPatches.fn.clearLine = true;
stdoutPatches.fn.cursorTo = true;

/* Transform simple wrappers, indicated by fn[functionName] = true, into fully-formed wrapper functions */
for (let fnName in stdoutPatches.fnName) {
  if (stdoutPatches[fnName] === true) {
    stdoutPatches[fnName] = new FnNameGeneric('stdout', fnName);
  }
}
for (let fnName in stdoutPatches.fnName) {
  if (stdoutPatches[fnName] === true) {
    stdoutPatches[fnName] = new FnNameGeneric('stdout', fnName);
  }
}

process.stdout.patches = stdoutPatches;
process.stdin.patches = stdinPatches;

function pxGet(target, prop) {
  if (target.patches.get[prop])
    return target.patches.get[prop]();
  if (target.patches.fn[prop])
    return target.patches.fn[prop];
  return target[prop];
}
function pxSet(target, prop, value) {
  if (target.patches.set[prop])
    return target.patches.set[prop](value);
  return target[prop] = value;
}

delete process.stdin;
process.stdin = new Proxy(realStdin, {
  get: pxGet,
  set: pxSet,

  has: function niim_preload$$stdin$has(target, prop) {
    return prop in stdin;
  },

  ownKeys: function niim_preload$$stdin$ownKeys(target) {
    let seen = {};
    return []
      .concat(Object.getOwnPropertyNames(stdin))
      .concat(Object.getOwnPropertySymbols(stdin))
      .concat(Object.getOwnPropertyNames(target.patches.get))
      .concat(Object.getOwnPropertyNames(target.patches.set))
      .concat(Object.getOwnPropertyNames(target.patches.fn))
      .filter((el) => { let ret = !seen.hasOwnProperty(el); seen[el] = true; return ret });
  },
});

delete process.stdout;
process.stdout = new Proxy(realStdout, {
  get: pxGet,
  set: pxSet,

  has: function niim_preload$$stdin$has(target, prop) {
    return prop in stdin;
  },

  ownKeys: function niim_preload$$stdin$ownKeys(target) {
    let seen = {};
    return []
      .concat(Object.getOwnPropertyNames(stdin))
      .concat(Object.getOwnPropertySymbols(stdin))
      .concat(Object.getOwnPropertyNames(target.patches.get))
      .concat(Object.getOwnPropertyNames(target.patches.set))
      .concat(Object.getOwnPropertyNames(target.patches.fn))
      .filter((el) => { let ret = !seen.hasOwnProperty(el); seen[el] = true; return ret });
  },
});



/** 
 * Write data to the stdout pipeline, for display in the debugger.
 * Since this stream is used to pass messages in the <NUL>{JSON}<NUL>
 * format, "regular" stdout output escapes all intances of <NUL> with <NUL><NUL>.
 */
process.stdout.write = function niim_preload$$stdout$write(chunk, encoding, callback) {

  if (!callback && typeof encoding === 'function') {
    callback = encoding;
    encoding = undefined;
  }

  if (typeof chunk === 'string')
    chunk = Buffer.from(chunk, encoding);

  while((i = chunk.indexOf(0) >= 0)) {
    stdoutWrite(chunk.slice(0, i));
    if (chunk.length === i) {
      chunk = NULNUL;
      break;
    }
    stdoutWrite(NULNUL);
    chunk = chunk.slice(i + 1);
  }

  return stdoutWrite(chunk, callback);
}

function nop(){};

/** 
 * Send a control message from the debuggee to the debugger.
 * @param    message  {Object}    The message to send
 */
function sendMessage(message) {
  /* use _write() and mess with internal properties to try and ensure
   * the data gets sent to the underlying I/O calls as quickly as
   * possible, even if that means inserting it in the middle of other
   * enqueued data.  This avoids bugs where parameters (eg raw mode)
   * are changed immediately before entering an operation that should
   * affect the debugger at the other end of the pipeline right away,
   * rather than on the nex tick.
   */
  let corked = process.stdout.corked;
  let json = JSON.stringify(message);
  let buf = Buffer.from('\x00' + json + '\x00', 'utf8');

  if (debug)
    console.log('[ debuggee: sending command to debugger: ', json);

  process.stdout.corked = 0;
  stdout_Write(buf, 'utf', nop);
  process.stdout.corked = corked;
}

if (debug)
  console.log('[ debuggee: niim preload ready');
