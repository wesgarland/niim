'use strict';
const { test } = require('tap');

const startCLI = require('./start-cli');

test('examples/alive.js', (t) => {
  const cli = startCLI(['examples/alive.js']);

  function onFatal(error) {
    cli.quit();
    throw error;
  }

  return cli.waitForInitialBreak()
    .then(() => cli.waitForPrompt())
    .then(() => cli.command('repl'))
    .then(() => cli.waitForPrompt())
    .then(() => cli.completer(''))
    .then(() => cli.waitFor(/Array/))
    .then(() => cli.completer('glo'))
    .then(() => cli.waitFor(/globalThis/))
    .then(() => {
      t.match(
        cli.output,
        'global',
        'could access "global" itself');
      t.match(
        cli.output,
        'globalThis',
        'could access "globalThis"');
    })
    .then(() => cli.completer('global.'))
    .then(() => cli.waitFor(/global\.Array/))
    .then(() => cli.completer('global.glo'))
    .then(() => cli.waitFor(/global\.globalThis/))
    .then(() => {
      t.match(
        cli.output,
        'global.global');
      t.match(
        cli.output,
        'global.globalThis');
    })
    .then(() => cli.completer('global.globalThis'))
    .then(() => cli.waitFor(/global\.globalThis/))
    .then(() => {
      t.notMatch(
        cli.output,
        /global\.global\n/);
      t.match(
        cli.output,
        /global\.globalThis/);
    })
    .then(() => cli.completer('Arr'))
    .then(() => cli.waitFor(/ArrayBuffer/))
    .then(() => {
      t.match(
        cli.output,
        'Array');
      t.match(
        cli.output,
        'ArrayBuffer');
    })
    .then(() => cli.completer('process.'))
    .then(() => cli.waitFor(/process\.versions/))
    .then(() => {
      t.match(
        cli.output,
        'process.version',
        'could access property of "version" from "process"');
    })
    .then(() => cli.completer('process.version'))
    .then(() => cli.waitFor(/process\.versions/))
    .then(() => {
      t.match(
        cli.output,
        'process',
        '"process" should have both properties of "version" '
          + 'and "versions" when search for "version"');
    })
    .then(() => cli.command('var myUniqueObj = { first: 1, second: 2 }'))
    .then(() => cli.completer('myUnique'))
    .then(() => cli.waitFor(/myUniqueObj/))
    .then(() => cli.completer('myUniqueObj.'))
    .then(() => cli.waitFor(/second/))
    .then(() => {
      t.match(cli.output, 'first', 'shoud print the property "first"');
      t.match(cli.output, 'second', 'shoud print the property "second"');
    })
    .then(() => cli.completer(''))
    .then(() => cli.completer('myUniqueObj.firs'))
    .then(() => cli.waitFor(/first/))
    .then(() => {
      t.match(cli.output, 'myUniqueObj.first');
      t.notMatch(cli.output, 'second');
    })
    .then(() => cli.quit())
    .then(null, onFatal);
});
