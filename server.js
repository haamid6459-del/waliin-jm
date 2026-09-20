const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

app.get("/api/status", (req, res) => {
  res.json({
    app: "Waliin-JM",
    status: "online",
    rooms: rooms.size
  });
});

io.on("connection", (socket) => {

  socket.on("create-room", ({ roomId, username }) => {
    if (!roomId || !username) return;

    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        owner: username,
        users: new Map()
      });
    }

    socket.join(roomId);

    const room = rooms.get(roomId);

    room.users.set(socket.id, {
      username,
      socketId: socket.id,
      admin: room.owner === username
    });

    socket.roomId = roomId;
    socket.username = username;

    socket.emit("room-created", {
      roomId,
      username,
      users: [...room.users.values()]
    });

    socket.to(roomId).emit("user-joined", {
      username,
      socketId: socket.id
    });
  });

  socket.on("join-room", ({ roomId, username }) => {
    if (!roomId || !username) return;

    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        owner: username,
        users: new Map()
      });
    }

    const room = rooms.get(roomId);

    if (room.users.size >= 10) {
      socket.emit("room-full");
      return;
    }

    socket.join(roomId);

    room.users.set(socket.id, {
      username,
      socketId: socket.id,
      admin: false
    });

    socket.roomId = roomId;
    socket.username = username;

    socket.emit("room-joined", {
      roomId,
      username,
      users: [...room.users.values()]
    });

    socket.to(roomId).emit("user-joined", {
      username,
      socketId: socket.id
    });
  });

  socket.on("chat-message", (message) => {
    if (!socket.roomId) return;

    io.to(socket.roomId).emit("chat-message", {
      username: socket.username,
      message,
      time: new Date().toLocaleTimeString()
    });
  });

  socket.on("typing", () => {
    if (socket.roomId) {
      socket.to(socket.roomId).emit("typing", {
        username: socket.username
      });
    }
  });

  socket.on("offer", ({ target, offer }) => {
    io.to(target).emit("offer", {
      offer,
      from: socket.id,
      username: socket.username
    });
  });

  socket.on("answer", ({ target, answer }) => {
    io.to(target).emit("answer", {
      answer,
      from: socket.id
    });
  });

  socket.on("ice-candidate", ({ target, candidate }) => {
    io.to(target).emit("ice-candidate", {
      candidate,
      from: socket.id
    });
  });

  socket.on("mute-user", ({ target }) => {
    io.to(target).emit("force-mute");
  });

  socket.on("disconnect", () => {
    const roomId = socket.roomId;

    if (!roomId || !rooms.has(roomId)) return;

    const room = rooms.get(roomId);

    room.users.delete(socket.id);

    socket.to(roomId).emit("user-left", {
      username: socket.username,
      socketId: socket.id
    });

    if (room.users.size === 0) {
      rooms.delete(roomId);
    }
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

server.listen(PORT, () => {
  console.log(`Waliin-JM server running on port ${PORT}`);
});
