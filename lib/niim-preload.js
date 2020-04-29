/**
 * @file       niim-preload.js          Module which is included via the `node -r` facility when launching
 *                                      a node program that is going to be attached to with niim.  This
 *                                      module sets up the plumbing for debuggee's control code to communicate
 *                                      with the debugger, so that facilities like tty raw mode can be
 *                                      negotiated over the socketpair that is established by the spawn.
 * @author     Wes Garland, wes@kingsds.network
 * @date       April 2020
 */
"use strict";

/* later: implement two-way control.  Send parent stdin columns, row, WINCH over extra 4th socket. keep stdout escape to preserve I/O vs message ordering */
/* then the wrapper factory learns the difference between functions and procedures and can ask for return values over the protocol.  Use blocking read of control socket for sync? */

const moduleSystem = require('module');
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
  return function niimPreload$$wrapper() {
    sendMessage({type: 'tty', which: label, fn: fn, arguments: Array.from(arguments)})
  };
}

stdinPatches.fn.setRawMode = function niimPreload$$stdin$set_RawMode(arg) {
  debuggerInfo.isRaw = arg;

  if (!stdinPatches.fn.setRawMode._impl)
    stdinPatches.fn.setRawMode._impl = WrapperFactory('stdin', 'setRawMode');
  stdinPatches.fn.setRawMode._impl.apply(null, arguments);
}

stdinPatches.get.isRaw = function niimPreload$$stdin$get_isRaw() {
  return debuggerInfo.isRaw;
}

stdinPatches.get.isTTY = function niimPreload$$stdin$get_isTTY() {
  return debuggerInfo.isTTY;
}

stdinPatches.set.isTTY = function niimPreload$$stdin$set_isTTY(value) {
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
  target[prop] = value;
  return true;
}

delete process.stdin;
process.stdin = new Proxy(realStdin, {
  get: pxGet,
  set: pxSet,

  has: function niimPreload$$stdin$has(target, prop) {
    return prop in stdin;
  },

  ownKeys: function niimPreload$$stdin$ownKeys(target) {
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

  has: function niimPreload$$stdin$has(target, prop) {
    return prop in stdin;
  },

  ownKeys: function niimPreload$$stdin$ownKeys(target) {
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
process.stdout.write = function niimPreload$$stdout$write(chunk, encoding, callback) {
  var i;
  
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

const injectedModules = {};
const resolveFilenamePrevious = moduleSystem._resolveFilename;
moduleSystem._resolveFilename = function nimmPreload$$injectModule$resolveFilenameShim(moduleIdentifier) { 
  if (injectedModules.hasOwnProperty(moduleIdentifier))
    return moduleIdentifier;
  return resolveFilenamePrevious.apply(null, arguments)
}
/**
 * Inject an initialized module into the native NodeJS module system.
 *
 * @param       id              {string}        module identifier
 * @param       moduleExports   {object}        the module's exports object
 * @param       clobber         {boolean}       inject on top of an existing module identifier
 *                                              if there is a collsion.
 * @throw Error if there is a collision and clobber is not truey.
 */
function injectModule(id, moduleExports, clobber) {
  if (!clobber && typeof moduleSystem._cache[id] !== 'undefined')
    throw new Error(`Module ${id} has already been injected`);
  moduleSystem._cache[id] = new (moduleSystem.Module);
  moduleSystem._cache[id].id = id;
  moduleSystem._cache[id].parent = module;
  moduleSystem._cache[id].exports = moduleExports;
  moduleSystem._cache[id].filename = id;
  moduleSystem._cache[id].loaded = true;
  injectedModules[id] = true;
  debug && console.log(` - injected module ${id}: ${typeof moduleExports === 'object' ? Object.keys(moduleExports) : '(' + typeof moduleExports + ')'}`);
}

/** Tell the debugger to engage/disable interactive terminal mode */
function itm(arg) {
  sendMessage({type: 'itm', arg: arg});
}
  
injectModule('niim', { itm: itm }, true);

/* trap SIGINT so that propagation from the parent process does not kill the debuggee */
process.on('SIGINT', function() {
  if (debug)
    console.log('[ debuggee: trapped SIGINT');
});

if (debug)
  console.log('[ debuggee: niim preload ready');
