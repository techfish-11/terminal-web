const http = require("http");
const WebSocket = require("ws");
const pty = require("node-pty");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const logStream = fs.createWriteStream("access.log", { flags: "a" });

const server = http.createServer((req, res) => {
  if (req.url === "/") {
    fs.readFile("public/index.html", (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end("Error");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocket.Server({ server });

wss.on("connection", (ws, req) => {
  const sessionId = uuidv4();
  const ip = req.headers["x-real-ip"] || req.socket.remoteAddress;
  logStream.write(
    `[${new Date().toISOString()}] Session ${sessionId} connected from ${ip}\n`
  );

  ws.send(JSON.stringify({ type: "session", sessionId }));

  const ptyProcess = pty.spawn(
    "docker",
    [
      "run",
      "--rm",
      "-i",
      "--network",
      "none",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--tmpfs",
      "/tmp",
      "--tmpfs",
      "/dev",
      "--tmpfs",
      "/run",
      "--memory",
      "64m",
      "--cpus",
      "0.2",
      "alpine",
      "/bin/sh",
    ],
    {
      name: "xterm-color",
      cols: 80,
      rows: 24,
      cwd: process.env.HOME,
      env: process.env,
    }
  );

  let inputBuffer = "";

  ptyProcess.on("data", (data) => ws.send(JSON.stringify({ type: "data", data })));

  ws.on("message", (msg) => {
    inputBuffer += msg;
    if (msg.includes("\r") || msg.includes("\n")) {
      const command = inputBuffer.replace(/[\r\n]+$/, "");
      if (command.trim() !== "") {
        logStream.write(
          `[${new Date().toISOString()}] Session ${sessionId} (${ip}) executed: ${JSON.stringify(
            command
          )}\n`
        );
      }
      inputBuffer = "";
    }
    ptyProcess.write(msg);
  });

  ws.on("close", () => {
    logStream.write(
      `[${new Date().toISOString()}] Session ${sessionId} (${ip}) disconnected\n`
    );
    ptyProcess.kill();
  });
});

server.listen(3000, () => {
  console.log("Ready: http://localhost:3000");
});
