const express = require("express");
const http = require("http");
const path = require("path");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const { Server } = require("socket.io");
const { createClient } = require("redis");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* =========================
   REDIS
========================= */

const REDIS_URL = process.env.REDIS_URL;

let redis = null;

async function connectRedis() {
  if (!REDIS_URL) {
    console.log("REDIS_URL hin argamne.");
    return;
  }

  try {
    redis = createClient({
      url: REDIS_URL
    });

    redis.on("error", (err) => {
      console.error("Redis Error:", err.message);
    });

    await redis.connect();

    console.log("Redis connected successfully.");
  } catch (error) {
    console.error("Redis connection failed:", error.message);
  }
}

async function saveUser(user) {
  if (!redis) return;

  await redis.set(
    `user:${user.email}`,
    JSON.stringify(user)
  );
}

async function getUser(email) {
  if (!redis) return null;

  const data = await redis.get(`user:${email}`);

  if (!data) return null;

  return JSON.parse(data);
}

/* =========================
   ROOMS
========================= */

const rooms = new Map();

function createSeats(count) {
  return Array.from({ length: count }, (_, index) => ({
    number: index + 1,
    socketId: null,
    username: null,
    locked: false,
    micOn: false
  }));
}

function getParticipants(room) {
  return Array.from(room.users.values()).map((user) => ({
    socketId: user.socketId,
    username: user.username,
    role: user.role,
    seat: user.seat,
    micOn: user.micOn,
    muted: user.muted,
    handRaised: user.handRaised
  }));
}

function getClassroomState(room) {
  return {
    roomId: room.id,
    type: room.type,
    seatCount: room.seatCount,
    seats: room.seats,
    hostId: room.hostId,
    teacherId: room.teacherId,
    participants: getParticipants(room),
    raisedHands: room.raisedHands
  };
}

function broadcastClassroom(room) {
  io.to(room.id).emit(
    "classroom-state",
    getClassroomState(room)
  );
}

/* =========================
   API
========================= */

app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    app: "WALIIN JM",
    database: redis ? "Redis connected" : "Redis not connected",
    classroom: true,
    seats: [10, 15],
    unlimitedAudience: true
  });
});

/* =========================
   SIGNUP
========================= */

app.post("/api/signup", async (req, res) => {
  try {
    const {
      username,
      email,
      password
    } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Username, email fi password guuti."
      });
    }

    if (!redis) {
      return res.status(500).json({
        success: false,
        message: "Database connection hin jiru."
      });
    }

    const existingUser = await getUser(email);

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Email kun duraan fayyadameera."
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = {
      username,
      email,
      passwordHash,
      bio: "",
      avatar: "",
      status: "",
      coins: 1000,
      createdAt: new Date().toISOString()
    };

    await saveUser(user);

    res.json({
      success: true,
      message: "Account uumameera.",
      user: {
        username: user.username,
        email: user.email,
        coins: user.coins
      }
    });

  } catch (error) {
    console.error("Signup error:", error);

    res.status(500).json({
      success: false,
      message: "Signup irratti rakkoon uumame."
    });
  }
});

/* =========================
   LOGIN
========================= */

app.post("/api/login", async (req, res) => {
  try {
    const {
      email,
      password
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email fi password guuti."
      });
    }

    if (!redis) {
      return res.status(500).json({
        success: false,
        message: "Database connection hin jiru."
      });
    }

    const user = await getUser(email);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Email ykn password sirrii miti."
      });
    }

    const passwordCorrect = await bcrypt.compare(
      password,
      user.passwordHash
    );

    if (!passwordCorrect) {
      return res.status(401).json({
        success: false,
        message: "Email ykn password sirrii miti."
      });
    }

    res.json({
      success: true,
      message: "Login milkaa'eera.",
      user: {
        username: user.username,
        email: user.email,
        bio: user.bio,
        avatar: user.avatar,
        status: user.status,
        coins: user.coins
      }
    });

  } catch (error) {
    console.error("Login error:", error);

    res.status(500).json({
      success: false,
      message: "Login irratti rakkoon uumame."
    });
  }
});

/* =========================
   PROFILE
========================= */

app.get("/api/user/:email", async (req, res) => {
  try {
    const user = await getUser(req.params.email);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User hin argamne."
      });
    }

    res.json({
      success: true,
      user: {
        username: user.username,
        email: user.email,
        bio: user.bio,
        avatar: user.avatar,
        status: user.status,
        coins: user.coins
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Profile irratti rakkoon uumame."
    });
  }
});

/* =========================
   ROOM ID
========================= */

function generateRoomId() {
  return Math.random()
    .toString(36)
    .substring(2, 8)
    .toUpperCase();
}

/* =========================
   SOCKET.IO
========================= */

io.on("connection", (socket) => {

  console.log("User connected:", socket.id);

  /* =====================
     CREATE ROOM
  ===================== */

  socket.on("create-room", (data, callback) => {

    try {
      const username = data.username || "Guest";

      const requestedSeats =
        Number(data.seatCount) === 15 ? 15 : 10;

      let roomId = generateRoomId();

      while (rooms.has(roomId)) {
        roomId = generateRoomId();
      }

      const room = {
        id: roomId,
        type: data.type || "classroom",
        password: data.password || "",
        seatCount: requestedSeats,
        seats: createSeats(requestedSeats),
        hostId: socket.id,
        teacherId: null,
        users: new Map(),
        raisedHands: [],
        messages: [],
        gifts: []
      };

      const user = {
        socketId: socket.id,
        username,
        role: "host",
        seat: null,
        micOn: false,
        muted: false,
        handRaised: false
      };

      room.users.set(socket.id, user);
      rooms.set(roomId, room);

      socket.join(roomId);

      socket.data.roomId = roomId;
      socket.data.username = username;

      callback?.({
        success: true,
        roomId
      });

      broadcastClassroom(room);

    } catch (error) {
      console.error("Create room error:", error);

      callback?.({
        success: false,
        message: "Room uumuu hin dandeenye."
      });
    }
  });

  /* =====================
     JOIN ROOM
  ===================== */

  socket.on("join-room", (data, callback) => {

    const roomId = data.roomId;

    const room = rooms.get(roomId);

    if (!room) {
      return callback?.({
        success: false,
        message: "Room hin argamne."
      });
    }

    if (
      room.password &&
      room.password !== (data.password || "")
    ) {
      return callback?.({
        success: false,
        message: "Password room sirrii miti."
      });
    }

    const username = data.username || "Guest";

    const user = {
      socketId: socket.id,
      username,
      role: "audience",
      seat: null,
      micOn: false,
      muted: false,
      handRaised: false
    };

    room.users.set(socket.id, user);

    socket.join(roomId);

    socket.data.roomId = roomId;
    socket.data.username = username;

    callback?.({
      success: true,
      roomId,
      role: user.role
    });

    broadcastClassroom(room);

    io.to(roomId).emit("user-joined", {
      socketId: socket.id,
      username
    });
  });

  /* =====================
     VOICE CLUB JOIN
  ===================== */

  socket.on("voice-club-join", (data, callback) => {

    const room = rooms.get(data.roomId);

    if (!room) {
      return callback?.({
        success: false,
        message: "Club hin argamne."
      });
    }

    const username = data.username || "Guest";

    const user = {
      socketId: socket.id,
      username,
      role: "audience",
      seat: null,
      micOn: false,
      muted: false,
      handRaised: false
    };

    room.users.set(socket.id, user);

    socket.join(room.id);

    socket.data.roomId = room.id;
    socket.data.username = username;

    callback?.({
      success: true,
      roomId: room.id
    });

    broadcastClassroom(room);
  });

  /* =====================
     PROMOTE TO SEAT
  ===================== */

  socket.on("promote-to-seat", (data, callback) => {

    const room = rooms.get(socket.data.roomId);

    if (!room) return;

    const requester = room.users.get(socket.id);

    if (
      requester.role !== "host" &&
      requester.role !== "teacher"
    ) {
      return callback?.({
        success: false,
        message: "Host ykn Teacher qofa."
      });
    }

    const target = room.users.get(data.userId);

    if (!target) {
      return callback?.({
        success: false,
        message: "User hin argamne."
      });
    }

    const seatNumber = Number(data.seatNumber);

    const seat = room.seats.find(
      (s) => s.number === seatNumber
    );

    if (!seat) {
      return callback?.({
        success: false,
        message: "Seat hin argamne."
      });
    }

    if (seat.locked) {
      return callback?.({
        success: false,
        message: "Seat locked dha."
      });
    }

    if (seat.socketId) {
      return callback?.({
        success: false,
        message: "Seat kun qabameera."
      });
    }

    if (target.seat) {
      return callback?.({
        success: false,
        message: "User kun seat qaba."
      });
    }

    seat.socketId = target.socketId;
    seat.username = target.username;
    seat.micOn = false;

    target.seat = seatNumber;
    target.role = "student";

    callback?.({
      success: true
    });

    broadcastClassroom(room);
  });

  /* =====================
     SEAT TO AUDIENCE
  ===================== */

  socket.on("seat-to-audience", (data, callback) => {

    const room = rooms.get(socket.data.roomId);

    if (!room) return;

    const requester = room.users.get(socket.id);

    if (
      requester.role !== "host" &&
      requester.role !== "teacher"
    ) {
      return callback?.({
        success: false,
        message: "Permission hin qabdu."
      });
    }

    const target = room.users.get(data.userId);

    if (!target) return;

    if (target.seat) {

      const seat = room.seats.find(
        (s) => s.number === target.seat
      );

      if (seat) {
        seat.socketId = null;
        seat.username = null;
        seat.micOn = false;
      }

      target.seat = null;
      target.role = "audience";
      target.micOn = false;
    }

    callback?.({
      success: true
    });

    broadcastClassroom(room);
  });

  /* =====================
     LOCK / UNLOCK SEAT
  ===================== */

  socket.on("toggle-seat-lock", (data, callback) => {

    const room = rooms.get(socket.data.roomId);

    if (!room) return;

    const requester = room.users.get(socket.id);

    if (requester.role !== "host") {
      return callback?.({
        success: false,
        message: "Host qofa."
      });
    }

    const seat = room.seats.find(
      (s) => s.number === Number(data.seatNumber)
    );

    if (!seat) return;

    seat.locked = !seat.locked;

    callback?.({
      success: true,
      locked: seat.locked
    });

    broadcastClassroom(room);
  });

  /* =====================
     TOGGLE MIC
  ===================== */

  socket.on("toggle-mic", (callback) => {

    const room = rooms.get(socket.data.roomId);

    if (!room) return;

    const user = room.users.get(socket.id);

    if (!user) return;

    if (
      !user.seat &&
      user.role !== "host" &&
      user.role !== "teacher"
    ) {
      return callback?.({
        success: false,
        message: "Audience seat malee mic banachuu hin danda'u."
      });
    }

    if (user.muted) {
      return callback?.({
        success: false,
        message: "Mic kee hostiin mute godhameera."
      });
    }

    user.micOn = !user.micOn;

    if (user.seat) {

      const seat = room.seats.find(
        (s) => s.number === user.seat
      );

      if (seat) {
        seat.micOn = user.micOn;
      }
    }

    socket.emit("mic-changed", {
      micOn: user.micOn
    });

    broadcastClassroom(room);

    callback?.({
      success: true,
      micOn: user.micOn
    });
  });

  /* =====================
     MUTE USER
  ===================== */

  socket.on("mute-user", (data, callback) => {

    const room = rooms.get(socket.data.roomId);

    if (!room) return;

    const requester = room.users.get(socket.id);

    if (requester.role !== "host") {
      return callback?.({
        success: false,
        message: "Host qofa mute gochuu danda'a."
      });
    }

    const target = room.users.get(data.userId);

    if (!target) return;

    target.muted = true;
    target.micOn = false;

    if (target.seat) {

      const seat = room.seats.find(
        (s) => s.number === target.seat
      );

      if (seat) {
        seat.micOn = false;
      }
    }

    io.to(target.socketId).emit("force-mute");

    broadcastClassroom(room);

    callback?.({
      success: true
    });
  });

  /* =====================
     UNMUTE USER
  ===================== */

  socket.on("unmute-user", (data, callback) => {

    const room = rooms.get(socket.data.roomId);

    if (!room) return;

    const requester = room.users.get(socket.id);

    if (requester.role !== "host") {
      return callback?.({
        success: false,
        message: "Host qofa."
      });
    }

    const target = room.users.get(data.userId);

    if (!target) return;

    target.muted = false;

    io.to(target.socketId).emit("unmuted-by-host");

    broadcastClassroom(room);

    callback?.({
      success: true
    });
  });

  /* =====================
     MAKE TEACHER
  ===================== */

  socket.on("make-teacher", (data, callback) => {

    const room = rooms.get(socket.data.roomId);

    if (!room) return;

    const requester = room.users.get(socket.id);

    if (requester.role !== "host") {
      return callback?.({
        success: false,
        message: "Host qofa."
      });
    }

    const target = room.users.get(data.userId);

    if (!target) return;

    if (room.teacherId) {

      const oldTeacher =
        room.users.get(room.teacherId);

      if (oldTeacher) {
        oldTeacher.role =
          oldTeacher.seat ? "student" : "audience";
      }
    }

    room.teacherId = target.socketId;
    target.role = "teacher";

    callback?.({
      success: true
    });

    broadcastClassroom(room);
  });

  /* =====================
     RAISE HAND
  ===================== */

  socket.on("raise-hand", (callback) => {

    const room = rooms.get(socket.data.roomId);

    if (!room) return;

    const user = room.users.get(socket.id);

    if (!user) return;

    user.handRaised = !user.handRaised;

    if (user.handRaised) {

      if (!room.raisedHands.includes(socket.id)) {
        room.raisedHands.push(socket.id);
      }

    } else {

      room.raisedHands =
        room.raisedHands.filter(
          (id) => id !== socket.id
        );
    }

    broadcastClassroom(room);

    callback?.({
      success: true,
      handRaised: user.handRaised
    });
  });

  /* =====================
     CHAT
  ===================== */

  socket.on("chat-message", (data) => {

    const room = rooms.get(socket.data.roomId);

    if (!room) return;

    const user = room.users.get(socket.id);

    if (!user) return;

    const message = {
      id: Date.now(),
      socketId: socket.id,
      username: user.username,
      message: String(data.message || "").substring(0, 1000),
      time: new Date().toISOString()
    };

    room.messages.push(message);

    if (room.messages.length > 100) {
      room.messages.shift();
    }

    io.to(room.id).emit(
      "chat-message",
      message
    );
  });

  /* =====================
     TYPING
  ===================== */

  socket.on("typing", (data) => {

    const room = rooms.get(socket.data.roomId);

    if (!room) return;

    socket.to(room.id).emit("typing", {
      username: data.username || "User"
    });
  });

  /* =====================
     WEBRTC OFFER
  ===================== */

  socket.on("offer", (data) => {

    if (!data.target) return;

    io.to(data.target).emit("offer", {
      offer: data.offer,
      sender: socket.id
    });
  });

  /* =====================
     WEBRTC ANSWER
  ===================== */

  socket.on("answer", (data) => {

    if (!data.target) return;

    io.to(data.target).emit("answer", {
      answer: data.answer,
      sender: socket.id
    });
  });

  /* =====================
     ICE
  ===================== */

  socket.on("ice-candidate", (data) => {

    if (!data.target) return;

    io.to(data.target).emit(
      "ice-candidate",
      {
        candidate: data.candidate,
        sender: socket.id
      }
    );
  });

  /* =====================
     REMOVE USER
  ===================== */

  socket.on("remove-user", (data, callback) => {

    const room = rooms.get(socket.data.roomId);

    if (!room) return;

    const requester = room.users.get(socket.id);

    if (requester.role !== "host") {
      return callback?.({
        success: false,
        message: "Host qofa."
      });
    }

    const target = room.users.get(data.userId);

    if (!target) return;

    io.to(target.socketId).emit(
      "removed-from-room"
    );

    const targetSocket =
      io.sockets.sockets.get(target.socketId);

    if (targetSocket) {
      targetSocket.leave(room.id);
      targetSocket.data.roomId = null;
    }

    if (target.seat) {

      const seat = room.seats.find(
        (s) => s.number === target.seat
      );

      if (seat) {
        seat.socketId = null;
        seat.username = null;
        seat.micOn = false;
      }
    }

    room.users.delete(target.socketId);

    room.raisedHands =
      room.raisedHands.filter(
        (id) => id !== target.socketId
      );

    broadcastClassroom(room);

    callback?.({
      success: true
    });
  });

  /* =====================
     CALL START
  ===================== */

  socket.on("call-start", (data) => {

    const room = rooms.get(socket.data.roomId);

    if (!room) return;

    socket.to(room.id).emit(
      "call-started",
      {
        caller: socket.id,
        type: data.type || "video"
      }
    );
  });

  /* =====================
     CALL END
  ===================== */

  socket.on("call-end", () => {

    const room = rooms.get(socket.data.roomId);

    if (!room) return;

    socket.to(room.id).emit(
      "call-ended",
      {
        caller: socket.id
      }
    );
  });

  /* =====================
     DISCONNECT
  ===================== */

  socket.on("disconnect", () => {

    console.log("User disconnected:", socket.id);

    const roomId = socket.data.roomId;

    if (!roomId) return;

    const room = rooms.get(roomId);

    if (!room) return;

    const user = room.users.get(socket.id);

    if (user) {

      if (user.seat) {

        const seat = room.seats.find(
          (s) => s.number === user.seat
        );

        if (seat) {
          seat.socketId = null;
          seat.username = null;
          seat.micOn = false;
        }
      }

      room.users.delete(socket.id);

      room.raisedHands =
        room.raisedHands.filter(
          (id) => id !== socket.id
        );

      /* HOST LEAVES */

      if (room.hostId === socket.id) {

        const nextUser =
          room.users.values().next().value;

        if (nextUser) {

          room.hostId =
            nextUser.socketId;

          nextUser.role = "host";

          room.teacherId =
            room.teacherId === socket.id
              ? null
              : room.teacherId;

        } else {

          rooms.delete(roomId);

          return;
        }
      }

      /* TEACHER LEAVES */

      if (room.teacherId === socket.id) {
        room.teacherId = null;
      }

      broadcastClassroom(room);

      io.to(room.id).emit(
        "user-left",
        {
          socketId: socket.id
        }
      );
    }
  });
});

/* =========================
   START SERVER
========================= */

async function startServer() {

  await connectRedis();

  server.listen(PORT, () => {
    console.log(
      `WALIIN JM server running on port ${PORT}`
    );
  });
}

startServer();
