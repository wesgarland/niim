# niim FAQ

### How to debug a program that reads from stdin?
* Question from https://stackoverflow.com/questions/20126875/how-can-one-feed-stuff-into-a-scripts-stdin-while-in-the-debugger-interface *

To feed a file into stdin, use the `sendFile(filename)` command, to feed a string into stdin, use the `send(string)` command.  Don't
forget to append a newline ('\n') if your program is excpecting to you press enter!

If you want to interact with your program; for example, if you need to enter a password or are debugging a REPL, use the `ctty` command to
connect niim's controlling tty to the attached process; press Control-C to return control back to the debugger. 

### How to programmatically detect niim?
* Question from https://stackoverflow.com/questions/6889470/how-to-programmatically-detect-debug-mode-in-nodejs *

```javascript
let nimm;
try {
  nimm = require('niim');
} catch(e) {}
if (nimm) {
  console.log('niim loaded');
}
```

### What's the best way to prompt for a password?
If your program normally operates in line mode (terminal line discipline), it probably prompts for a password by
switching the tty to character mode, so that the password isn't echoed to the screen. This is normally accomplished
via `process.stdout.setRawMode()` in NodeJS, and niim is aware of this pattern.  Simply write your program as usual,
and switch to raw mode just before you send the password prompt out stdin and switch back to line mode when the
password has been entered.  Next, edit the niim config file corresponding to this program, and add
```javascript
niim.autoRawITM = true;
```

### Where is the niim config file for my program?
If your home directory is `/users/JohnDoe` and program is named `/var/hello/world.js`, then niim will read the config file
`/users/JohnDoe/.niim/world.config`.

### Can I override niim settings for all programs?
Yes. If your home directory is `/users/JohnDoe` then niim will read use the master config file
`/users/JohnDoe/.niim/config`.

