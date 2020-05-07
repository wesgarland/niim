/**
 * @file        niim-util.js    Utility functions for niim.
 * @author      Wes Garland, wes@kingsds.netwrok
 * @date        April 2020
 */
"use strict";

const os = require('os');

/**
 * Backup event listeners, removing them from the event emitter but preserving
 * them in the backup object.
 *
 * @param     {object}   eventEmitter            an instance of events::EventEmitter
 * @param     {Array}    eventNames              an optional list of event names; default=all
 * 
 * @returns   The backup object
 */
exports.backupEvents = function niimUtil$$backupEvents(eventEmitter, eventNames) { 
  var backup = {};
  if (!eventNames)
    eventNames = eventEmitter.eventNames();

  for (let eventName of eventNames) {
    backup[eventName] = [];
    for (let listener of eventEmitter.listeners(eventName)) {
      backup[eventName].push(listener);
      eventEmitter.off(eventName, listener);
    }
  }

  return backup;
}

/**
 * Restore event emitters in the format from backupEvents.
 * 
 * @param     {object}   backup                  The backup object
 * @param     {object}   eventEmitter            an instance of events::EventEmitter
 * @param     {Array}    eventNames              an optional list of event names; default=all
 */
exports.restoreEvents = function niimUtils$$restoreEvents(backup, eventEmitter, eventNames) {
  if (!backup)
    return;
  
  for (let eventName of (eventNames || eventEmitter.eventNames())) {
    for (let listener of eventEmitter.listeners(eventName)) {
      eventEmitter.off(eventName, listener);
    }
  }

  for (let eventName of (eventNames || Object.keys(backup))) {
    for (let listener of backup[eventName]) {
      eventEmitter.on(eventName, listener);
    }
    delete backup[eventName];
  }
}

/** 
 * Generate a printable string from the input string which gives
 * reasonable labels to characters under 0x20. Has special knowledge
 * about os.EOL.
 * @param   str {string}    The string to print
 * return A printable string
 */ 
exports.printable = function niimUtil$$printable(str) {
  let i;

  if (Buffer.isBuffer(str)) {
    str = str.toString('utf8');
  }

  while ((i = str.indexOf(os.EOL)) !== -1) {
    str = str.slice(0, i) + '<enter>' + str.slice(i + os.EOL.length);
  }

  str = str
    .replace(/\x00/g, '<NUL>')
    .replace(/\x01/g, '^A')
    .replace(/\x02/g, '^B')
    .replace(/\x03/g, '^C')
    .replace(/\x04/g, '^D')
    .replace(/\x05/g, '^E')
    .replace(/\x06/g, '^F')
    .replace(/\x07/g, '^G')
    .replace(/\x08/g, '^H')
    .replace(/\x09/g, '^I')
    .replace(/\x0a/g, '\\r')
    .replace(/\x0b/g, '^K')
    .replace(/\x0c/g, '^L')
    .replace(/\x0d/g, '<newline>')
    .replace(/\x0e/g, '^N')
    .replace(/\x0f/g, '^O')
    .replace(/\x10/g, '^P')
    .replace(/\x11/g, '^Q')
    .replace(/\x12/g, '^R')
    .replace(/\x13/g, '^S')
    .replace(/\x14/g, '^T')
    .replace(/\x15/g, '^U')
    .replace(/\x16/g, '^V')
    .replace(/\x1a/g, '^W')
    .replace(/\x1b/g, '^X')
    .replace(/\x1c/g, '^Y')
    .replace(/\x1d/g, '^Z')
    .replace(/\x1e/g, '<RS>')
    .replace(/\x1f/g, '<US>');

  
  for (let i=1; i < arguments.length; i++)
    str += ' ' + exports.printable(arguments[i]);

  return str;
}

exports.overwriteArray = function niimUtil$$overwriteArray(target, source) {
  target.length = 0;
  target.splice.apply(target, [0, target.length].concat(source));
  return target;
}

exports.shortStackError = function niimUtil$$shortStackError(oldE, cutoffMatch) {
  var e = new oldE.constructor(oldE.message);
  var lines = oldE.stack.split('\n');

  e.stack = '';
  for (let i=0; i < lines.length; i++) {
    if (lines[i].match(cutoffMatch))
      break;
    e.stack += lines[i] + '\n';
  }
  
  return e.stack;
}
