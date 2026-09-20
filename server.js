const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

app.get("/api/status", (req, res) => {
  res.json({
    app: "Waliin-JM",
    status: "online",
    rooms: rooms.size
  });
});

io.on("connection", (socket) => {

  socket.on("create-room", ({ username, password = "" }) => {

    const roomId = generateRoomId();

    rooms.set(roomId, {
      password,
      users: new Map()
    });

    rooms.get(roomId).users.set(socket.id, {
      username,
      isAdmin: true
    });

    socket.join(roomId);

    socket.roomId = roomId;
    socket.username = username;
    socket.isAdmin = true;

    socket.emit("room-created", {
      roomId,
      username
    });
  });

  socket.on("join-room", ({ roomId, username, password = "" }) => {

    const room = rooms.get(roomId);

    if (!room) {
      socket.emit("room-error", "Room kun hin jiru.");
      return;
    }

    if (room.password && room.password !== password) {
      socket.emit("room-error", "Password roomii sirrii miti.");
      return;
    }

    if (room.users.size >= 10) {
      socket.emit("room-error", "Room kun namoota 10 guuteera.");
      return;
    }

    const existingUsers = [...room.users.entries()].map(
      ([id, user]) => ({
        socketId: id,
        username: user.username,
        isAdmin: user.isAdmin
      })
    );

    room.users.set(socket.id, {
      username,
      isAdmin: false
    });

    socket.join(roomId);

    socket.roomId = roomId;
    socket.username = username;
    socket.isAdmin = false;

    socket.emit("room-joined", {
      roomId,
      username,
      users: existingUsers
    });

    socket.to(roomId).emit("user-joined", {
      socketId: socket.id,
      username
    });

    io.to(roomId).emit(
      "participants",
      getParticipants(room)
    );
  });

  socket.on("chat-message", (data) => {

    if (!socket.roomId) return;

    io.to(socket.roomId).emit("chat-message", {
      username: socket.username,
      message: data.message,
      time: new Date().toLocaleTimeString()
    });
  });

  socket.on("typing", () => {

    if (!socket.roomId) return;

    socket.to(socket.roomId).emit("typing", {
      username: socket.username
    });
  });

  socket.on("offer", (data) => {
    io.to(data.target).emit("offer", {
      sender: socket.id,
      offer: data.offer
    });
  });

  socket.on("answer", (data) => {
    io.to(data.target).emit("answer", {
      sender: socket.id,
      answer: data.answer
    });
  });

  socket.on("ice-candidate", (data) => {
    io.to(data.target).emit("ice-candidate", {
      sender: socket.id,
      candidate: data.candidate
    });
  });

  socket.on("mute-user", (targetId) => {

    if (!socket.isAdmin || !socket.roomId) return;

    io.to(targetId).emit("force-mute");
  });

  socket.on("remove-user", (targetId) => {

    if (!socket.isAdmin || !socket.roomId) return;

    const room = rooms.get(socket.roomId);

    if (!room) return;

    const target = io.sockets.sockets.get(targetId);

    if (target) {
      target.emit("removed-from-room");
      target.leave(socket.roomId);
      target.roomId = null;
    }

    room.users.delete(targetId);

    io.to(socket.roomId).emit(
      "participants",
      getParticipants(room)
    );
  });

  socket.on("disconnect", () => {

    const roomId = socket.roomId;

    if (!roomId) return;

    const room = rooms.get(roomId);

    if (!room) return;

    room.users.delete(socket.id);

    socket.to(roomId).emit(
      "user-left",
      socket.id
    );

    if (room.users.size === 0) {
      rooms.delete(roomId);
    } else {
      io.to(roomId).emit(
        "participants",
        getParticipants(room)
      );
    }
  });
});

function getParticipants(room) {

  return [...room.users.entries()].map(
    ([socketId, user]) => ({
      socketId,
      username: user.username,
      isAdmin: user.isAdmin
    })
  );
}

app.get("*", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

server.listen(PORT, () => {
  console.log(`Waliin-JM running on port ${PORT}`);
});
