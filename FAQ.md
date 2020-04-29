# niim FAQ

### How to debug a program that reads from stdin?
*Question from [Stack Overflow](https://stackoverflow.com/questions/20126875/how-can-one-feed-stuff-into-a-scripts-stdin-while-in-the-debugger-interface)*

To feed a file into stdin, use the `sendFile(filename)` command, to feed a string into stdin, use the `send(string)` command.  Don't
forget to append a newline ('\n') if your program is excpecting to you press enter!

If you want to interact with your program; for example, if you need to enter a password or are debugging a REPL, use the `ctty` command to
connect niim's controlling tty to the attached process; press Control-C to return control back to the debugger. 

### How to programmatically detect niim?
*Question from [Stack Overflow](https://stackoverflow.com/questions/6889470/how-to-programmatically-detect-debug-mode-in-nodejs)*

```javascript
let niim;
try {
  niim = require('niim');
} catch(e) {}
if (niim) {
  console.log('niim loaded');
}
```

### Can I use niim to debug my REPL?
Probably - niim can debug itself!  Use the `ctty` command to drop from niim's repl into your own, then use ^C to
get back to niim.

### What's the best way to prompt for a password?
If your program normally operates in line mode (terminal line discipline), it probably prompts for a password by
switching the tty to character mode, so that the password isn't echoed to the screen. This is normally accomplished
via `process.stdout.setRawMode()` in NodeJS, and niim is aware of this pattern.  Simply write your program as usual,
and switch to raw mode just before you send the password prompt out stdin and switch back to line mode when the
password has been entered.  Next, edit the niim config file corresponding to this program, and add
```javascript
niim.autoRawITM = true;
```
This will cause niim to automatically drop into interactive terminal mode when your program is prompting for a password.

If that does not give you enough control, your program can make niim enter and exit interactive terminal mode at will,
via `require('niim').itm(true or false)`. *Note:* `require('niim')` will throw an exception when your program is running
without niim.

```javascript
try {
  var niim = require('niim');
} catch(e){};

if (niim) {
  niim.itm(true);
  setTimeout(() => niim.itm(false), 3000);
}
```

### Where is the niim config file for my program?
If your home directory is `/users/JohnDoe` and program is named `/var/hello/world.js`, then niim will read the config file
`/users/JohnDoe/.niim/world.config`.

### Can I override niim settings for all programs?
Yes. If your home directory is `/users/JohnDoe`, then niim will read use the config file
`/users/JohnDoe/.niim/config`.  Remember that niim supports multiple configuration files;
they are all read in order of least- to most-specific. Kind of like CSS rule matching.

### Where can I find all the configuration parameters for niim?
See /path/to/niim/etc/config, or https://github.com/wesgarland/niim/blob/master/etc/config


