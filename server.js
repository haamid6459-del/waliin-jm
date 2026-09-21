const express = require("express");
const http = require("http");
const path = require("path");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const { Server } = require("socket.io");
const { Pool } = require("pg");

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

console.log(
  "DATABASE_URL:",
  process.env.DATABASE_URL ? "FOUND" : "MISSING"
);

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL hin argamne.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

async function initDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL hin argamne.");
  }

  await pool.query("SELECT 1");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      bio TEXT DEFAULT '',
      avatar TEXT DEFAULT '',
      status TEXT DEFAULT '',
      coins INTEGER DEFAULT 1000,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("✅ PostgreSQL connected");
  console.log("✅ Users table ready");
}

const rooms = new Map();

function generateRoomId() {
  let id;

  do {
    id = Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase();
  } while (rooms.has(id));

  return id;
}

function createSeats(count) {
  return Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    socketId: null,
    username: null,
    locked: false,
    micOn: false
  }));
}

function getParticipants(room) {
  return Array.from(room.users.values()).map(user => ({
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
    raisedHands: room.raisedHands,
    voiceClubUsers: Array.from(room.voiceClubUsers)
  };
}

function broadcastClassroom(room) {
  io.to(room.id).emit(
    "classroom-state",
    getClassroomState(room)
  );
}

/* =========================
   STATUS
========================= */

app.get("/api/status", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      ok: true,
      app: "WALIIN JM",
      database: "PostgreSQL connected",
      classroom: true,
      seats: [10, 15],
      unlimitedAudience: true
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      app: "WALIIN JM",
      database: "PostgreSQL error",
      error: error.message
    });
  }
});

/* =========================
   SIGNUP
========================= */

app.post("/api/signup", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Username, email fi password guuti."
      });
    }

    const normalizedEmail = String(email)
      .trim()
      .toLowerCase();

    const existing = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [normalizedEmail]
    );

    if (existing.rows.length) {
      return res.status(409).json({
        success: false,
        message: "Email kun duraan fayyadameera."
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `
      INSERT INTO users
      (username, email, password_hash)
      VALUES ($1, $2, $3)
      RETURNING id, username, email, bio, avatar, status, coins
      `,
      [
        String(username).trim(),
        normalizedEmail,
        passwordHash
      ]
    );

    res.json({
      success: true,
      message: "Account uumameera.",
      user: result.rows[0]
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
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email fi password guuti."
      });
    }

    const normalizedEmail = String(email)
      .trim()
      .toLowerCase();

    const result = await pool.query(
      `
      SELECT
        id,
        username,
        email,
        password_hash,
        bio,
        avatar,
        status,
        coins
      FROM users
      WHERE email = $1
      `,
      [normalizedEmail]
    );

    if (!result.rows.length) {
      return res.status(401).json({
        success: false,
        message: "Email ykn password sirrii miti."
      });
    }

    const user = result.rows[0];

    const passwordCorrect =
      await bcrypt.compare(
        password,
        user.password_hash
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
        id: user.id,
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
   USER PROFILE
========================= */

app.get("/api/user/:email", async (req, res) => {
  try {
    const email = String(req.params.email)
      .trim()
      .toLowerCase();

    const result = await pool.query(
      `
      SELECT
        id,
        username,
        email,
        bio,
        avatar,
        status,
        coins
      FROM users
      WHERE email = $1
      `,
      [email]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "User hin argamne."
      });
    }

    res.json({
      success: true,
      user: result.rows[0]
    });

  } catch (error) {
    console.error("Profile error:", error);

    res.status(500).json({
      success: false,
      message: "Profile irratti rakkoon uumame."
    });
  }
});

/* =========================
   SOCKET.IO
========================= */

io.on("connection", socket => {

  console.log("🟢 Connected:", socket.id);

  /* CREATE ROOM */

  socket.on("create-room", (data, callback) => {

    const username =
      String(data?.username || "Guest");

    const seatCount =
      Number(data?.seatCount) === 15
        ? 15
        : 10;

    const roomId = generateRoomId();

    const room = {
      id: roomId,
      type: data?.type || "classroom",
      password: data?.password || "",
      seatCount,
      seats: createSeats(seatCount),
      hostId: socket.id,
      teacherId: null,
      users: new Map(),
      raisedHands: [],
      messages: [],
      gifts: [],
      voiceClubUsers: new Set()
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

    console.log(
      `🏠 Room created: ${roomId}`
    );
  });

  /* JOIN ROOM */

  socket.on("join-room", (data, callback) => {

    const room = rooms.get(
      String(data?.roomId || "")
        .trim()
        .toUpperCase()
    );

    if (!room) {
      return callback?.({
        success: false,
        message: "Room hin argamne."
      });
    }

    if (
      room.password &&
      room.password !==
      (data?.password || "")
    ) {
      return callback?.({
        success: false,
        message: "Password sirrii miti."
      });
    }

    const username =
      String(data?.username || "Guest");

    const user = {
      socketId: socket.id,
      username,
      role: "audience",
      seat: null,
      micOn: false,
      muted: false,
      handRaised: false
    };

    room.users.set(
      socket.id,
      user
    );

    socket.join(room.id);

    socket.data.roomId = room.id;
    socket.data.username = username;

    callback?.({
      success: true,
      roomId: room.id,
      role: user.role
    });

    socket.to(room.id).emit(
      "user-joined",
      {
        socketId: socket.id,
        username
      }
    );

    broadcastClassroom(room);
  });

  /* PROMOTE TO SEAT */

  socket.on(
    "promote-to-seat",
    (data, callback) => {

      const room =
        rooms.get(socket.data.roomId);

      if (!room) return;

      const requester =
        room.users.get(socket.id);

      if (
        !requester ||
        (
          requester.role !== "host" &&
          requester.role !== "teacher"
        )
      ) {
        return callback?.({
          success: false,
          message: "Host ykn Teacher qofa."
        });
      }

      const target =
        room.users.get(data?.userId);

      if (!target) {
        return callback?.({
          success: false,
          message: "User hin argamne."
        });
      }

      const seatNumber =
        Number(data?.seatNumber);

      const seat =
        room.seats.find(
          s => s.number === seatNumber
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
          message: "Seat qabameera."
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

      target.seat = seatNumber;
      target.role = "student";

      callback?.({
        success: true
      });

      broadcastClassroom(room);
    }
  );

  /* SEAT TO AUDIENCE */

  socket.on(
    "seat-to-audience",
    (data, callback) => {

      const room =
        rooms.get(socket.data.roomId);

      if (!room) return;

      const requester =
        room.users.get(socket.id);

      if (
        !requester ||
        (
          requester.role !== "host" &&
          requester.role !== "teacher"
        )
      ) {
        return callback?.({
          success: false,
          message: "Permission hin qabdu."
        });
      }

      const target =
        room.users.get(data?.userId);

      if (!target) return;

      if (target.seat) {

        const seat =
          room.seats.find(
            s => s.number === target.seat
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
    }
  );

  /* LOCK SEAT */

  socket.on(
    "toggle-seat-lock",
    (data, callback) => {

      const room =
        rooms.get(socket.data.roomId);

      if (!room) return;

      const requester =
        room.users.get(socket.id);

      if (
        !requester ||
        requester.role !== "host"
      ) {
        return callback?.({
          success: false,
          message: "Host qofa."
        });
      }

      const seat =
        room.seats.find(
          s =>
            s.number ===
            Number(data?.seatNumber)
        );

      if (!seat) return;

      seat.locked = !seat.locked;

      callback?.({
        success: true,
        locked: seat.locked
      });

      broadcastClassroom(room);
    }
  );

  /* MIC */

  socket.on(
    "toggle-mic",
    callback => {

      const room =
        rooms.get(socket.data.roomId);

      if (!room) return;

      const user =
        room.users.get(socket.id);

      if (!user) return;

      if (
        !user.seat &&
        user.role !== "host" &&
        user.role !== "teacher"
      ) {
        return callback?.({
          success: false,
          message: "Seat malee mic hin banatu."
        });
      }

      if (user.muted) {
        return callback?.({
          success: false,
          message: "Mic mute godhameera."
        });
      }

      user.micOn = !user.micOn;

      if (user.seat) {

        const seat =
          room.seats.find(
            s => s.number === user.seat
          );

        if (seat) {
          seat.micOn = user.micOn;
        }
      }

      callback?.({
        success: true,
        micOn: user.micOn
      });

      broadcastClassroom(room);
    }
  );

  /* MUTE */

  socket.on(
    "mute-user",
    (data, callback) => {

      const room =
        rooms.get(socket.data.roomId);

      if (!room) return;

      const requester =
        room.users.get(socket.id);

      if (
        !requester ||
        requester.role !== "host"
      ) {
        return callback?.({
          success: false,
          message: "Host qofa."
        });
      }

      const target =
        room.users.get(data?.userId);

      if (!target) return;

      target.muted = true;
      target.micOn = false;

      if (target.seat) {

        const seat =
          room.seats.find(
            s => s.number === target.seat
          );

        if (seat) {
          seat.micOn = false;
        }
      }

      io.to(target.socketId)
        .emit("force-mute");

      callback?.({
        success: true
      });

      broadcastClassroom(room);
    }
  );

  /* UNMUTE */

  socket.on(
    "unmute-user",
    (data, callback) => {

      const room =
        rooms.get(socket.data.roomId);

      if (!room) return;

      const requester =
        room.users.get(socket.id);

      if (
        !requester ||
        requester.role !== "host"
      ) {
        return callback?.({
          success: false,
          message: "Host qofa."
        });
      }

      const target =
        room.users.get(data?.userId);

      if (!target) return;

      target.muted = false;

      io.to(target.socketId)
        .emit("unmuted-by-host");

      callback?.({
        success: true
      });

      broadcastClassroom(room);
    }
  );

  /* MAKE TEACHER */

  socket.on(
    "make-teacher",
    (data, callback) => {

      const room =
        rooms.get(socket.data.roomId);

      if (!room) return;

      const requester =
        room.users.get(socket.id);

      if (
        !requester ||
        requester.role !== "host"
      ) {
        return callback?.({
          success: false,
          message: "Host qofa."
        });
      }

      const target =
        room.users.get(data?.userId);

      if (!target) return;

      if (room.teacherId) {

        const oldTeacher =
          room.users.get(
            room.teacherId
          );

        if (oldTeacher) {
          oldTeacher.role =
            oldTeacher.seat
              ? "student"
              : "audience";
        }
      }

      room.teacherId =
        target.socketId;

      target.role = "teacher";

      callback?.({
        success: true
      });

      broadcastClassroom(room);
    }
  );

  /* RAISE / LOWER HAND */

  socket.on(
    "raise-hand",
    callback => {

      const room =
        rooms.get(socket.data.roomId);

      if (!room) return;

      const user =
        room.users.get(socket.id);

      if (!user) return;

      user.handRaised =
        !user.handRaised;

      if (user.handRaised) {

        if (
          !room.raisedHands.includes(
            socket.id
          )
        ) {
          room.raisedHands.push(
            socket.id
          );
        }

      } else {

        room.raisedHands =
          room.raisedHands.filter(
            id => id !== socket.id
          );
      }

      callback?.({
        success: true,
        handRaised:
          user.handRaised
      });

      broadcastClassroom(room);
    }
  );

  socket.on(
    "lower-hand",
    callback => {

      const room =
        rooms.get(socket.data.roomId);

      if (!room) return;

      const user =
        room.users.get(socket.id);

      if (!user) return;

      user.handRaised = false;

      room.raisedHands =
        room.raisedHands.filter(
          id => id !== socket.id
        );

      callback?.({
        success: true
      });

      broadcastClassroom(room);
    }
  );

  /* CHAT */

  socket.on(
    "chat-message",
    data => {

      const room =
        rooms.get(socket.data.roomId);

      if (!room) return;

      const user =
        room.users.get(socket.id);

      if (!user) return;

      const messageText =
        String(data?.message || "")
          .trim()
          .substring(0, 1000);

      if (!messageText) return;

      const message = {
        id: Date.now(),
        socketId: socket.id,
        username: user.username,
        message: messageText,
        time: new Date().toISOString()
      };

      room.messages.push(message);

      if (room.messages.length > 100) {
        room.messages.shift();
      }

      io.to(room.id)
        .emit("chat-message", message);
    }
  );

  /* TYPING */

  socket.on(
    "typing",
    data => {

      const room =
        rooms.get(socket.data.roomId);

      if (!room) return;

      socket.to(room.id)
        .emit("typing", {
          username:
            data?.username || "User"
        });
    }
  );

  /* =========================
     WEBRTC
  ========================= */

  socket.on("offer", data => {

    if (!data?.target) return;

    io.to(data.target)
      .emit("offer", {
        offer: data.offer,
        sender: socket.id
      });
  });

  socket.on("answer", data => {

    if (!data?.target) return;

    io.to(data.target)
      .emit("answer", {
        answer: data.answer,
        sender: socket.id
      });
  });

  socket.on(
    "ice-candidate",
    data => {

      if (!data?.target) return;

      io.to(data.target)
        .emit("ice-candidate", {
          candidate: data.candidate,
          sender: socket.id
        });
    }
  );

  /* CALL START */

  socket.on(
    "call-start",
    data => {

      const room =
        rooms.get(socket.data.roomId);

      if (!room) return;

      socket.to(room.id)
        .emit("call-started", {
          caller: socket.id,
          type:
            data?.type || "video"
        });
    }
  );

  socket.on(
    "call-end",
    () => {

      const room =
        rooms.get(socket.data.roomId);

      if (!room) return;

      socket.to(room.id)
        .emit("call-ended", {
          caller: socket.id
        });
    }
  );

  /* =========================
     VOICE CLUB
  ========================= */

  socket.on(
    "voice-club-join",
    callback => {

      const room =
        rooms.get(socket.data.roomId);

      if (!room) return;

      room.voiceClubUsers.add(
        socket.id
      );

      io.to(room.id).emit(
        "voice-club-state",
        Array.from(
          room.voiceClubUsers
        )
      );

      callback?.({
        success: true
      });
    }
  );

  socket.on(
    "voice-club-leave",
    callback => {

      const room =
        rooms.get(socket.data.roomId);

      if (!room) return;

      room.voiceClubUsers.delete(
        socket.id
      );

      io.to(room.id).emit(
        "voice-club-state",
        Array.from(
          room.voiceClubUsers
        )
      );

      callback?.({
        success: true
      });
    }
  );

  /* =========================
     GIFTS
  ========================= */

  socket.on(
    "sendGift",
    data => {

      const room =
        rooms.get(socket.data.roomId);

      if (!room) return;

      const user =
        room.users.get(socket.id);

      if (!user) return;

      const gift = {
        id: Date.now(),
        from: user.username,
        type:
          data?.type || "gift",
        amount:
          Number(data?.amount) || 1,
        time: new Date().toISOString()
      };

      room.gifts.push(gift);

      if (room.gifts.length > 100) {
        room.gifts.shift();
      }

      io.to(room.id)
        .emit(
          "giftReceived",
          gift
        );
    }
  );

  /* REMOVE USER */

  socket.on(
    "remove-user",
    (data, callback) => {

      const room =
        rooms.get(socket.data.roomId);

      if (!room) return;

      const requester =
        room.users.get(socket.id);

      if (
        !requester ||
        requester.role !== "host"
      ) {
        return callback?.({
          success: false,
          message: "Host qofa."
        });
      }

      const target =
        room.users.get(data?.userId);

      if (!target) return;

      io.to(target.socketId)
        .emit("removed-from-room");

      const targetSocket =
        io.sockets.sockets.get(
          target.socketId
        );

      if (targetSocket) {

        targetSocket.leave(room.id);

        targetSocket.data.roomId =
          null;
      }

      if (target.seat) {

        const seat =
          room.seats.find(
            s => s.number === target.seat
          );

        if (seat) {

          seat.socketId = null;
          seat.username = null;
          seat.micOn = false;
        }
      }

      room.users.delete(
        target.socketId
      );

      room.raisedHands =
        room.raisedHands.filter(
          id => id !== target.socketId
        );

      room.voiceClubUsers.delete(
        target.socketId
      );

      broadcastClassroom(room);

      callback?.({
        success: true
      });
    }
  );

  /* DISCONNECT */

  socket.on(
    "disconnect",
    () => {

      console.log(
        "🔴 Disconnected:",
        socket.id
      );

      const roomId =
        socket.data.roomId;

      if (!roomId) return;

      const room =
        rooms.get(roomId);

      if (!room) return;

      const user =
        room.users.get(socket.id);

      if (!user) return;

      if (user.seat) {

        const seat =
          room.seats.find(
            s => s.number === user.seat
          );

        if (seat) {

          seat.socketId = null;
          seat.username = null;
          seat.micOn = false;
        }
      }

      room.users.delete(
        socket.id
      );

      room.raisedHands =
        room.raisedHands.filter(
          id => id !== socket.id
        );

      room.voiceClubUsers.delete(
        socket.id
      );

      if (
        room.teacherId ===
        socket.id
      ) {
        room.teacherId = null;
      }

      if (
        room.hostId ===
        socket.id
      ) {

        const nextUser =
          room.users.values()
            .next().value;

        if (nextUser) {

          room.hostId =
            nextUser.socketId;

          nextUser.role = "host";

        } else {

          rooms.delete(roomId);

          return;
        }
      }

      broadcastClassroom(room);

      io.to(room.id).emit(
        "user-left",
        {
          socketId: socket.id
        }
      );
    }
  );
});

/* =========================
   START
========================= */

async function startServer() {

  try {

    await initDatabase();

    server.listen(
      PORT,
      "0.0.0.0",
      () => {

        console.log(
          `🚀 WALIIN JM running on port ${PORT}`
        );
      }
    );

  } catch (error) {

    console.error(
      "❌ SERVER START FAILED:",
      error.message
    );

    process.exit(1);
  }
}

startServer();
