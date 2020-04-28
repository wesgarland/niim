/**
 * @file        niim-util.js    Utility functions for niim.
 * @author      Wes Garland, wes@kingsds.netwrok
 * @date        April 2020
 */

const os = require('os');

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
