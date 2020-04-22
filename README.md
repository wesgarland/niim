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
