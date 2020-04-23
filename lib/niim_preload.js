/**
 * @file       niim_preload.js          Module which is included via the `node -r` facility when launching
 *                                      a node program that is going to be attached to with niim.  This
 *                                      module sets up the plumbing for debuggee's control code to communicate
 *                                      with the debugger, so that facilities like tty raw mode can be
 *                                      negotiated over the socketpair that is established by the spawn.
 * @author     Wes Garland, wes@kingsds.network
 * @date       April 2020
 */

const process = require('process');
const stdin = process.stdin;
const stdout = process.stdout;
const stdoutWrite = process.stdout.write.bind(process.stdout);
const stdout_Write = process.stdout._write.bind(process.stdout);
const debuggerInfo = JSON.parse(unescape(process.env.NIIM) || {});
const NUL = Buffer.from([0]);
const NULNUL = Buffer.from([0,0]);

Object.assign(debuggerInfo, { isRaw: false });

exports.setRawMode = function niim_preload$$setRawMode(arg) {
  debuggerInfo.isRaw = arg;
  sendMessage({type: 'rawMode', value: arg});
}

exports.isRaw = function niim_preload$$isRaw() {
  return debuggerInfo.isRaw;
}

/* Proxy stdin to get around unchangeable property isRaw */
delete process.stdin;
process.stdin = new Proxy(stdin, {

  get: function niim_preload$$stdin$get(target, prop) {
    switch(prop) {
      case 'setRawMode':
        return exports.setRawMode;
      case 'isRaw':
        return debuggerInfo.isRaw;
    }
    return target[prop];
  },

  set: function niim_preload$$stdin$set(target, prop, value) {
    stdin[prop] = value;
  },

  has: function niim_preload$$stdin$has(target, prop) {
    return prop in stdin;
  },

  ownKeys: function niim_preload$$stdin$ownKeys(target) {
    return []
      .concat(Object.getOwnPropertyNames(stdin))
      .concat(Object.getOwnPropertySymbols(stdin));
  },
});

process.stdout.isTTY = debuggerInfo.isTTY;

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

  process.stdout.corked = 0;
  stdout_Write(buf, 'utf', nop);
  process.stdout.corked = corked;
}
