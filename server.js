const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const users = new Map();
const rooms = new Map();

function hashPassword(password) {
  return crypto
    .createHash("sha256")
    .update(password)
    .digest("hex");
}

/* SIGN UP */

app.post("/api/signup", (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.json({
      success: false,
      message: "Username, email fi password guuti."
    });
  }

  if (password.length < 6) {
    return res.json({
      success: false,
      message: "Password yoo xiqqaate qubee 6 qabaachuu qaba."
    });
  }

  const emailKey = email.toLowerCase().trim();

  if (users.has(emailKey)) {
    return res.json({
      success: false,
      message: "Email kun duraan account qaba."
    });
  }

  users.set(emailKey, {
    username: username.trim(),
    email: emailKey,
    password: hashPassword(password)
  });

  res.json({
    success: true,
    message: "Account uumameera."
  });
});

/* LOGIN */

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;

  const emailKey = String(email || "")
    .toLowerCase()
    .trim();

  const user = users.get(emailKey);

  if (!user) {
    return res.json({
      success: false,
      message: "Email ykn password sirrii miti."
    });
  }

  if (user.password !== hashPassword(password)) {
    return res.json({
      success: false,
      message: "Email ykn password sirrii miti."
    });
  }

  res.json({
    success: true,
    user: {
      username: user.username,
      email: user.email
    }
  });
});

/* STATUS */

app.get("/api/status", (req, res) => {
  res.json({
    app: "Waliin-JM",
    status: "online",
    users: users.size,
    rooms: rooms.size
  });
});

/* ROOMS */

function generateRoomId() {
  return Math.random()
    .toString(36)
    .substring(2, 8)
    .toUpperCase();
}

io.on("connection", (socket) => {

  socket.on("create-room", ({ username, password = "" }) => {

    const roomId = generateRoomId();

    rooms.set(roomId, {
      password,
      users: new Map()
    });

    const room = rooms.get(roomId);

    room.users.set(socket.id, {
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

    io.to(roomId).emit(
      "participants",
      getParticipants(room)
    );
  });

  socket.on("join-room", ({ roomId, username, password = "" }) => {

    const room = rooms.get(roomId);

    if (!room) {
      socket.emit(
        "room-error",
        "Room kun hin jiru."
      );
      return;
    }

    if (
      room.password &&
      room.password !== password
    ) {
      socket.emit(
        "room-error",
        "Password roomii sirrii miti."
      );
      return;
    }

    if (room.users.size >= 10) {
      socket.emit(
        "room-error",
        "Room kun namoota 10 guuteera."
      );
      return;
    }

    const existingUsers =
      getParticipants(room);

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

    socket.to(roomId).emit(
      "user-joined",
      {
        socketId: socket.id,
        username
      }
    );

    io.to(roomId).emit(
      "participants",
      getParticipants(room)
    );
  });

  socket.on("chat-message", (data) => {

    if (!socket.roomId) return;

    io.to(socket.roomId).emit(
      "chat-message",
      {
        username: socket.username,
        message: data.message,
        time: new Date()
          .toLocaleTimeString()
      }
    );
  });

  socket.on("typing", () => {

    if (!socket.roomId) return;

    socket.to(socket.roomId).emit(
      "typing",
      {
        username: socket.username
      }
    );
  });

  socket.on("offer", (data) => {

    io.to(data.target).emit(
      "offer",
      {
        sender: socket.id,
        offer: data.offer
      }
    );
  });

  socket.on("answer", (data) => {

    io.to(data.target).emit(
      "answer",
      {
        sender: socket.id,
        answer: data.answer
      }
    );
  });

  socket.on("ice-candidate", (data) => {

    io.to(data.target).emit(
      "ice-candidate",
      {
        sender: socket.id,
        candidate: data.candidate
      }
    );
  });

  socket.on("mute-user", (targetId) => {

    if (!socket.isAdmin) return;

    io.to(targetId).emit(
      "force-mute"
    );
  });

  socket.on("remove-user", (targetId) => {

    if (!socket.isAdmin) return;

    const room = rooms.get(socket.roomId);

    if (!room) return;

    const target =
      io.sockets.sockets.get(targetId);

    if (target) {

      target.emit(
        "removed-from-room"
      );

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

  return [
    ...room.users.entries()
  ].map(([socketId, user]) => ({
    socketId,
    username: user.username,
    isAdmin: user.isAdmin
  }));
}

app.get("*", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

server.listen(PORT, () => {
  console.log(
    `Waliin-JM running on port ${PORT}`
  );
});
