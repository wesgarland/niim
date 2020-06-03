/**
 * @file       niim-preload.js          Module which is included via the `node -r` facility when launching
 *                                      a node program that is going to be attached to (debugged) with niim.
 *                                      This module sets up the plumbing for debuggee's control code to 
 *                                      communicate with the debugger, so that facilities like tty raw mode
 *                                      can be negotiated over the sockets that are established by the spawn.
 *
 *                                      The debugger communicates certain things, link initial window size,
 *                                      to this module via the NIIM environment variable.
 *
 * @author     Wes Garland, wes@kingsds.network
 * @date       April 2020
 */
"use strict";

/* later: implement two-way control.  Send parent stdin columns, row, WINCH over extra 4th socket. keep stdout escape to preserve I/O vs message ordering */
/* then the wrapper factory learns the difference between functions and procedures and can ask for return values over the protocol.  Use blocking read of control socket for sync? */
/* the 4th socket will also eventually be necessary for Windows startup, given the total env size limit is 32K */

const moduleSystem = require('module');
const process = require('process');
const tty = require('tty');
const realStdin = process.stdin;
const realStdout = process.stdout;
const realStderr = process.stderr;
const stdoutWrite = process.stdout.write.bind(process.stdout);
const stdout_Write = process.stdout._write.bind(process.stdout);
const debuggerInfo = JSON.parse(unescape(process.env.NIIM));
const NUL = Buffer.from([0]);
const NULNUL = Buffer.from([0,0]);
const stdinPatches  = { setter: {}, getter: {}, value: {}, fns: '', label: 'stdin' };
const stdoutPatches = { setter: {}, getter: {}, value: {}, fns: '', label: 'stdout' };
const stderrPatches = { setter: {}, getter: {}, value: {}, fns: '', label: 'stderr' };
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

stdinPatches.getter.setRawMode = function niimPreload$$stdin$setRawMode_getter() {
  return function niimPreload$$setRawMode(arg) {
    debuggerInfo.stdin.isRaw = arg;
    sendMessage({type: 'tty', which: 'stdin', fn: 'setRawMode', arguments: Array.from(arguments)})
    return process.stdin;
  }
}

stdinPatches.getter.isRaw = function niimPreload$$stdin$isRaw_getter() {
  return debuggerInfo.stdin.isRaw;
}

stdinPatches.getter.isTTY = function niimPreload$$stdin$isTTY_getter() {
  return debuggerInfo.stdin.isTTY;
}

stdoutPatches.getter.getWindowSize = function niimPreload$getWindowSize() {
  return () => [ debuggerInfo.stdout.columns, debuggerInfo.stdout.rows ];
}
stderrPatches.getter.getWindowSize = stdoutPatches.getter.getWindowSize;

stdoutPatches.getter.getColorDepth = () => require('tty').WriteStream.prototype.getColorDepth;
stderrPatches.getter.getColorDepth = () => require('tty').WriteStream.prototype.getColorDepth;
stdoutPatches.getter.hasColors     = () => require('tty').WriteStream.prototype.hasColors;
stderrPatches.getter.hasColors     = () => require('tty').WriteStream.prototype.hasColors;

/* Simple value wrappers defined, with their backing stores */
stdinPatches.value.isTTY    = { obj: debuggerInfo.stdin,  prop: 'isTTY' };

stdoutPatches.value.isTTY   = { obj: debuggerInfo.stdout, prop: 'isTTY' };
stdoutPatches.value.rows    = { obj: debuggerInfo.stdout, prop: 'rows' };
stdoutPatches.value.columns = { obj: debuggerInfo.stdout, prop: 'columns' };

stderrPatches.value.isTTY   = { obj: debuggerInfo.stderr,  prop: 'isTTY' };
stderrPatches.value.rows    = { obj: debuggerInfo.stderr, prop: 'rows' };
stderrPatches.value.columns = { obj: debuggerInfo.stderr, prop: 'columns' };

/* "true" wrappers are automatically transformed via WrapperFactory 
 * constructor into real wrapper functions on first use. 
 */
stdoutPatches.fns = [ 'clearLine', 'cursorTo', 'moveCursor', 'clearScreenDown' ];
stderrPatches.fns = [ 'clearLine', 'cursorTo', 'moveCursor', 'clearScreenDown' ];

process.stdin.patches  = stdinPatches;
process.stdout.patches = stdoutPatches;
process.stderr.patches = stderrPatches;

function pxGet(target, prop) {
  var i;

  if (typeof prop === 'string' && (i = target.patches.fns.indexOf(prop)) !== -1) { /* patch is a function wrapper */
    target.patches.getter[prop] = () => new WrapperFactory(target.patches.label, prop);
    target.patches.fns.splice(i,1);
  }
  if (target.patches.getter[prop])       /* patched getter */
    return target.patches.getter[prop]();
  if (target.patches.value[prop])        /* patched value wrapper */
    return target.patches.value[prop].obj[target.patches.value[prop].prop];

  return target[prop];                /* fallthrough */
}

function pxSet(target, prop, value) {
  if (target.patches.setter[prop])
    target.patches.setter[prop](value);
  else if (target.patches.value[prop])
    target.patches.value[prop].obj[target.patches.value[prop].prop] = value;
  else
    target[prop] = value;
  return true;
}

function pxHas(target, prop) {
  return prop in target;
}

function pxOwnKeys(target) {
  let seen = {};
  return []
    .concat(Object.getOwnPropertyNames(target))
    .concat(Object.getOwnPropertySymbols(target))
    .concat(Object.getOwnPropertyNames(target.patches.getter))
    .concat(Object.getOwnPropertyNames(target.patches.setter))
    .concat(Object.keys(target.patches.fns))
    .filter((el) => { let ret = !seen.hasOwnProperty(el); seen[el] = true; return ret });
}

delete process.stdin;
process.stdin = new Proxy(realStdin, {
  get: pxGet,
  set: pxSet,
  has: pxHas,
  ownKeys: pxOwnKeys
});

delete process.stdout;
process.stdout = new Proxy(realStdout, {
  get: pxGet,
  set: pxSet,
  has: pxHas,
  ownKeys: pxOwnKeys
});

delete process.stderr;
process.stderr = new Proxy(realStderr, {
  get: pxGet,
  set: pxSet,
  has: pxHas,
  ownKeys: pxOwnKeys
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

const realTTYModule = {...tty};
tty.isatty = function niimPreload$$isatty(fd) {
  if (fd === 0)
    return process.stdout.isTTY;
  if (fd === 1)
    return process.stdin.isTTY;
  if (fd === 2)
    return process.stderr.isTTY;
  return realTTYModule.isatty(fd);
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
moduleSystem._resolveFilename = function niimPreload$$injectModule$resolveFilenameShim(moduleIdentifier) { 
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
  debug && console.log(`[ injected module ${id}: ${typeof moduleExports === 'object' ? Object.keys(moduleExports) : '(' + typeof moduleExports + ')'}`);
}

/** Tell the debugger to engage/disable interactive terminal mode */
function itm(arg) {
  sendMessage({type: 'itm', arg: arg});
}
  
injectModule('niim', {
  itm: itm,
  state: debuggerInfo
}, true);

/* trap SIGINT so that propagation from the parent process does not kill the debuggee */
process.on('SIGINT', function() {
  if (debug)
    console.log('[ debuggee: trapped SIGINT');
});

/* avoid leaving zombies */
process.stdin.on('end', () => process.kill(process.pid));
process.stdin.on('close', () => process.kill(process.pid));
process.stdin.on('error', () => process.kill(process.pid));

if (debug)
  console.log('[ debuggee: niim preload ready');
