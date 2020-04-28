# `niim` - Node-Inspect IMproved

```bash
npm install --global niim
```

#### About
This project is a fork of the node-inspect project.  The goal is simple: to
scratch my own itches with respect to debugging command-line apps on NodeJS,
especially logged in via ssh.

#### Changes
* Can debug processes that require input on stdin
* Avoid startup pause by default
* Use randomized inspect port by default
* REPL history is maintained

The plan for version numbers is to track node-inspect, with letter suffixes 
for disambiguation.

#### Launching
```niim [options] <filename to debug>```

| Option | Behaviour |
|:-------|:----------|
| --port | Specify the port to use for the node-inspect protocol. Default: auto |
| -w     | Pause on startup, so you can set breakpoints |

| Environment Variable | Behaviour |
|:---------------------|:----------|
| NIIM_DEFAULT_PORT    | Specify the default port to use for the node-inspect protocol. |

#### Using
| New Command         | Behaviour |
|:--------------------|-----------|
| send(string)        | Send the string to the attached process' stdin |
| sendFile(filename)  | Send the named file to the attached process' stdin |
| ctty                | Suspend the REPL and enter interactive termimal mode |

#### Features
*Interactive Terminal Mode*
This feature is the /raison d'être for this fork, as our team frequently finds itself needing to enter
passphrases during our debugging sessions.

In this mode, the REPL is suspended and the debugger's stdin is fed to the attached process. If the attached
process is in raw mode, the debugger's terminal will also be set in raw mode.  During interactive terminal
mode, the debugger will also not print `<` symbols in front of the attached process' stdout.

If the attached process' stdin is in raw mode, or enters raw mode, the debugger will remain in interactive
terminal mode until the attached process' stdin exits raw mode, or the debugger receives SIGUSR1.

The niim preloader communicates with niim using its own protocol, over the attached process' stdout. All
messages are of the form <NUL>{json}<NUL>.  If the attached process writes a <NUL>, it is escaped with
a second <NUL>

To facilitate this mode, the niim preloader monkey-patches and otherwise tries to virtualize APIs
on process.stdin and process.stdout. Setting DEBUG_NIIM and/or DEBUG_NIIM_PRELOAD can yield insight
into the under-the-hood behaviour if strange things are happening for you.

It is *very important* that a process under debugging only is the stdout Stream interface for writing
to stdout if the data written can contain <NUL> characters.

*niim module*
The internal module `require("niim")` is supplied to the attached process via the niim preloader. This
library allows for niim-aware debug targets to interoperate with niim directly.

| Module export       | Behaviour |
|:--------------------|-----------|
| itm(boolean)        | true - enter interactive terminal mode.
                        false - exit interactive terminal mode. |

#### Configuration Files
niim ships with a niim.config master configuration in the etc/ directory of the package to describe all
of the configuration options and their defaults. The config files are read in the following order; the
last file read that sets a given property has precedence:
 - etc/niim.config
 - ~/.niim/config
 - ~/.niim/programs/your-program-name.config
 - filename passed with --config=

#### Other Debuggers
The fork root, node-inspect, is maintained by the NodeJS team. This is the 
debugger you launch with `node debug file`. The latest version of node-inspect
is available at https://github.com/nodejs/node-inspect. The principal author is
Jan Krems, jan.krems@gmail.com.

The V8 team maintain an excellent browser-based GUI debugger; it is available
at https://github.com/node-inspector/node-inspector.

#### References
* [Debugger Documentation](https://nodejs.org/api/debugger.html)
* [EPS: `node inspect` CLI debugger](https://github.com/nodejs/node-eps/pull/42)
* [Debugger Protocol Viewer](https://chromedevtools.github.io/debugger-protocol-viewer/)
* [Command Line API](https://developers.google.com/web/tools/chrome-devtools/debug/command-line/command-line-reference?hl=en)
