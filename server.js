const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// In-memory store
const clients = new Map(); // ws -> { id, name, color }
const messageHistory = []; // last 50 messages
const MAX_HISTORY = 50;

const COLORS = [
  "#00ff41", "#00ffff", "#ff6b35", "#f7931e", "#fff200",
  "#ff3399", "#cc00ff", "#00ccff", "#ff0044", "#39ff14",
  "#ff9900", "#00ff99", "#ff4488", "#44ffff", "#ffcc00"
];

let colorIndex = 0;
function nextColor() {
  return COLORS[colorIndex++ % COLORS.length];
}

function broadcast(data, excludeWs = null) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client !== excludeWs) {
      client.send(msg);
    }
  });
}

function broadcastAll(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

function broadcastUserCount() {
  broadcastAll({ type: "userCount", count: clients.size });
}

wss.on("connection", (ws) => {
  const clientId = uuidv4();

  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    if (data.type === "join") {
      const name = (data.name || "anon").slice(0, 20).replace(/[<>]/g, "");
      const color = nextColor();
      clients.set(ws, { id: clientId, name, color });

      // Send history to new user
      ws.send(JSON.stringify({ type: "history", messages: messageHistory }));

      // Send own identity back
      ws.send(JSON.stringify({ type: "identity", id: clientId, name, color }));

      // Announce join
      const joinMsg = {
        type: "system",
        text: `${name} connected`,
        timestamp: Date.now(),
      };
      messageHistory.push(joinMsg);
      if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
      broadcastAll(joinMsg);
      broadcastUserCount();
      return;
    }

    if (data.type === "message") {
      const client = clients.get(ws);
      if (!client) return;

      const text = (data.text || "").slice(0, 500).trim();
      if (!text) return;

      const msg = {
        type: "message",
        id: uuidv4(),
        userId: client.id,
        name: client.name,
        color: client.color,
        text,
        timestamp: Date.now(),
      };
      messageHistory.push(msg);
      if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
      broadcastAll(msg);
      return;
    }

    if (data.type === "typing") {
      const client = clients.get(ws);
      if (!client) return;
      broadcast({ type: "typing", name: client.name, color: client.color }, ws);
      return;
    }
  });

  ws.on("close", () => {
    const client = clients.get(ws);
    if (client) {
      clients.delete(ws);
      const leaveMsg = {
        type: "system",
        text: `${client.name} disconnected`,
        timestamp: Date.now(),
      };
      messageHistory.push(leaveMsg);
      if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
      broadcastAll(leaveMsg);
      broadcastUserCount();
    }
  });
});

server.listen(PORT, () => {
  console.log(`[HACKERCHAT] Server live on port ${PORT}`);
});
