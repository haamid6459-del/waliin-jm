const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const bcrypt = require("bcryptjs");
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

/* =========================
   DATABASE
========================= */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* =========================
   MEMORY
========================= */

const rooms = new Map();

/* =========================
   DATABASE SETUP
========================= */

async function initDatabase() {
  if (!process.env.DATABASE_URL) {
    console.log("DATABASE_URL hin argamne.");
    return;
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) NOT NULL,
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

    console.log("PostgreSQL database qophaa'eera.");
  } catch (error) {
    console.error("Database error:", error.message);
  }
}

/* =========================
   SIGN UP
========================= */

app.post("/api/signup", async (req, res) => {
  try {
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

    const cleanUsername = String(username).trim();
    const emailKey = String(email).toLowerCase().trim();

    const passwordHash = await bcrypt.hash(password, 12);

    await pool.query(
      `
      INSERT INTO users
      (username, email, password_hash)
      VALUES ($1, $2, $3)
      `,
      [cleanUsername, emailKey, passwordHash]
    );

    res.json({
      success: true,
      message: "Account uumameera."
    });

  } catch (error) {
    if (error.code === "23505") {
      return res.json({
        success: false,
        message: "Email kun duraan account qaba."
      });
    }

    console.error(error);

    res.status(500).json({
      success: false,
      message: "Account uumuu irratti rakkoon uumame."
    });
  }
});

/* =========================
   LOGIN
========================= */

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const emailKey = String(email || "")
      .toLowerCase()
      .trim();

    const result = await pool.query(
      `
      SELECT *
      FROM users
      WHERE email = $1
      `,
      [emailKey]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: false,
        message: "Email ykn password sirrii miti."
      });
    }

    const user = result.rows[0];

    const passwordOK = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!passwordOK) {
      return res.json({
        success: false,
        message: "Email ykn password sirrii miti."
      });
    }

    res.json({
      success: true,
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
    console.error(error);

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
      .toLowerCase()
      .trim();

    const result = await pool.query(
      `
      SELECT
        id,
        username,
        email,
        bio,
        avatar,
        status,
        coins,
        created_at
      FROM users
      WHERE email = $1
      `,
      [email]
    );

    if (result.rows.length === 0) {
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
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Server error."
    });
  }
});

/* =========================
   STATUS
========================= */

app.get("/api/status", (req, res) => {
  res.json({
    app: "Waliin-JM",
    status: "online",
    rooms: rooms.size,
    unlimitedAudience: true,
    classroom: true,
    seats: [10, 15],
    giftSystem: true,
    voiceClub: true,
    database: Boolean(process.env.DATABASE_URL)
  });
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
   CREATE CLASSROOM
========================= */

function createSeats(count) {
  return Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    locked: false,
    userId: null,
    username: null,
    role: null,
    mic: false,
    muted: false
  }));
}

/* =========================
   PARTICIPANTS
========================= */

function getParticipants(room) {
  return [...room.users.entries()].map(
    ([socketId, user]) => ({
      socketId,
      username: user.username,
      role: user.role,
      seat: user.seat,
      mic: user.mic,
      muted: user.muted,
      handRaised: user.handRaised
    })
  );
}

/* =========================
   CLASSROOM STATE
========================= */

function getClassroomState(room) {
  return {
    roomId: room.id,
    type: room.type,
    seatCount: room.seatCount,

    hostId: room.hostId,
    teacherId: room.teacherId,

    seats: room.seats,

    users: getParticipants(room),

    raisedHands: room.raisedHands,

    messages: room.messages.slice(-100),

    gifts: room.gifts.slice(-50)
  };
}

/* =========================
   BROADCAST CLASSROOM
========================= */

function broadcastClassroom(room) {
  io.to(room.id).emit(
    "classroom-state",
    getClassroomState(room)
  );

  io.to(room.id).emit(
    "participants",
    getParticipants(room)
  );
}

/* =========================
   SOCKET.IO
========================= */

io.on("connection", socket => {

  console.log(
    "User connected:",
    socket.id
  );

  /* =========================
     CREATE ROOM
  ========================= */

  socket.on(
    "create-room",
    ({
      username,
      password = "",
      type = "video",
      seatCount = 10
    }) => {

      seatCount = Number(seatCount);

      if (![10, 15].includes(seatCount)) {
        seatCount = 10;
      }

      const roomId = generateRoomId();

      const room = {
        id: roomId,
        password,
        type,
        seatCount,

        users: new Map(),

        seats: createSeats(seatCount),

        hostId: socket.id,

        teacherId: null,

        raisedHands: [],

        messages: [],

        gifts: []
      };

      room.users.set(
        socket.id,
        {
          username: username || "Host",
          role: "host",
          seat: null,
          mic: false,
          muted: false,
          handRaised: false
        }
      );

      rooms.set(roomId, room);

      socket.join(roomId);

      socket.roomId = roomId;
      socket.username = username || "Host";
      socket.isAdmin = true;
      socket.roomType = type;

      socket.emit(
        "room-created",
        {
          roomId,
          username: socket.username,
          type,
          seatCount
        }
      );

      broadcastClassroom(room);
    }
  );

  /* =========================
     JOIN ROOM
  ========================= */

  socket.on(
    "join-room",
    ({
      roomId,
      username,
      password = ""
    }) => {

      const id = String(roomId || "")
        .toUpperCase();

      const room = rooms.get(id);

      if (!room) {
        socket.emit(
          "room-error",
          "Club kun hin jiru."
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

      room.users.set(
        socket.id,
        {
          username: username || "User",
          role: "audience",
          seat: null,
          mic: false,
          muted: false,
          handRaised: false
        }
      );

      socket.join(id);

      socket.roomId = id;
      socket.username = username || "User";
      socket.isAdmin = false;
      socket.roomType = room.type;

      socket.emit(
        "room-joined",
        {
          roomId: id,
          username: socket.username,
          type: room.type,
          seatCount: room.seatCount,
          state: getClassroomState(room)
        }
      );

      socket.to(id).emit(
        "user-joined",
        {
          socketId: socket.id,
          username: socket.username
        }
      );

      broadcastClassroom(room);
    }
  );

  /* =========================
     VOICE CLUB JOIN
  ========================= */

  socket.on(
    "voice-club-join",
    ({
      roomId,
      username
    }) => {

      const id = String(roomId || "")
        .toUpperCase();

      const room = rooms.get(id);

      if (!room) {
        socket.emit(
          "room-error",
          "Voice Club hin jiru."
        );
        return;
      }

      room.users.set(
        socket.id,
        {
          username: username || "User",
          role: "audience",
          seat: null,
          mic: false,
          muted: false,
          handRaised: false
        }
      );

      socket.join(id);

      socket.roomId = id;
      socket.username = username || "User";
      socket.roomType = "voice-classroom";

      socket.to(id).emit(
        "voice-club-user-joined",
        {
          socketId: socket.id,
          username: socket.username
        }
      );

      broadcastClassroom(room);
    }
  );

  /* =========================
     PROMOTE AUDIENCE → SEAT
  ========================= */

  socket.on(
    "promote-to-seat",
    ({
      userId,
      seatNumber
    },
    callback) => {

      const room = rooms.get(
        socket.roomId
      );

      if (!room) return;

      const actor =
        room.users.get(socket.id);

      if (
        !actor ||
        !["host", "teacher"].includes(actor.role)
      ) {
        return callback?.({
          success: false,
          message: "Aangoo hin qabdu."
        });
      }

      const target =
        room.users.get(userId);

      const seat =
        room.seats.find(
          s =>
            s.number === Number(seatNumber)
        );

      if (!target || !seat) {
        return callback?.({
          success: false,
          message: "User ykn seat hin argamne."
        });
      }

      if (seat.locked) {
        return callback?.({
          success: false,
          message: "Seat kun LOCKED dha."
        });
      }

      if (seat.userId) {
        return callback?.({
          success: false,
          message: "Seat kun nama qaba."
        });
      }

      if (target.seat) {
        return callback?.({
          success: false,
          message: "User kun seat irra jira."
        });
      }

      target.seat = seat.number;
      target.role = "student";
      target.mic = false;
      target.muted = false;
      target.handRaised = false;

      seat.userId = target.id;
      seat.username = target.username;
      seat.role = "student";
      seat.mic = false;
      seat.muted = false;

      room.raisedHands =
        room.raisedHands.filter(
          id => id !== target.id
        );

      io.to(target.id).emit(
        "seat-promoted",
        {
          seatNumber: seat.number
        }
      );

      callback?.({
        success: true
      });

      broadcastClassroom(room);
    }
  );

  /* =========================
     SEAT → AUDIENCE
  ========================= */

  socket.on(
    "seat-to-audience",
    ({
      userId
    },
    callback) => {

      const room =
        rooms.get(socket.roomId);

      if (!room) return;

      const actor =
        room.users.get(socket.id);

      if (
        !actor ||
        !["host", "teacher"].includes(actor.role)
      ) {
        return callback?.({
          success: false,
          message: "Aangoo hin qabdu."
        });
      }

      const target =
        room.users.get(userId);

      if (!target || !target.seat) {
        return callback?.({
          success: false,
          message: "Student seat irra hin jiru."
        });
      }

      const seat =
        room.seats.find(
          s =>
            s.number === target.seat
        );

      if (seat) {
        seat.userId = null;
        seat.username = null;
        seat.role = null;
        seat.mic = false;
        seat.muted = false;
      }

      target.seat = null;
      target.role = "audience";
      target.mic = false;

      callback?.({
        success: true
      });

      io.to(target.id).emit(
        "moved-to-audience"
      );

      broadcastClassroom(room);
    }
  );

  /* =========================
     LOCK / UNLOCK SEAT
  ========================= */

  socket.on(
    "toggle-seat-lock",
    ({
      seatNumber
    },
    callback) => {

      const room =
        rooms.get(socket.roomId);

      if (!room) return;

      const actor =
        room.users.get(socket.id);

      if (!actor || actor.role !== "host") {
        return callback?.({
          success: false,
          message: "Host qofa."
        });
      }

      const seat =
        room.seats.find(
          s =>
            s.number === Number(seatNumber)
        );

      if (!seat) {
        return callback?.({
          success: false,
          message: "Seat hin argamne."
        });
      }

      seat.locked = !seat.locked;

      callback?.({
        success: true,
        locked: seat.locked
      });

      broadcastClassroom(room);
    }
  );

  /* =========================
     MIC
  ========================= */

  socket.on(
    "toggle-mic",
    ({
      enabled
    },
    callback) => {

      const room =
        rooms.get(socket.roomId);

      if (!room) return;

      const user =
        room.users.get(socket.id);

      if (!user) return;

      if (
        user.role === "audience" &&
        !user.seat
      ) {
        return callback?.({
          success: false,
          message:
            "Audience seat irratti ol ba'uu qaba."
        });
      }

      if (
        user.muted &&
        enabled
      ) {
        return callback?.({
          success: false,
          message: "Mic kee mute dha."
        });
      }

      user.mic = Boolean(enabled);

      if (user.seat) {
        const seat =
          room.seats.find(
            s =>
              s.number === user.seat
          );

        if (seat) {
          seat.mic = user.mic;
        }
      }

      callback?.({
        success: true,
        mic: user.mic
      });

      broadcastClassroom(room);
    }
  );

  /* =========================
     MUTE USER
  ========================= */

  socket.on(
    "mute-user",
    (
      targetId,
      callback
    ) => {

      const room =
        rooms.get(socket.roomId);

      if (!room) return;

      const actor =
        room.users.get(socket.id);

      if (!actor || actor.role !== "host") {
        return callback?.({
          success: false,
          message: "Host qofa mute godha."
        });
      }

      const target =
        room.users.get(targetId);

      if (!target) {
        return callback?.({
          success: false,
          message: "User hin argamne."
        });
      }

      target.muted = true;
      target.mic = false;

      if (target.seat) {
        const seat =
          room.seats.find(
            s =>
              s.number === target.seat
          );

        if (seat) {
          seat.mic = false;
          seat.muted = true;
        }
      }

      io.to(targetId).emit(
        "force-mute"
      );

      callback?.({
        success: true
      });

      broadcastClassroom(room);
    }
  );

  /* =========================
     UNMUTE USER
  ========================= */

  socket.on(
    "unmute-user",
    (
      targetId,
      callback
    ) => {

      const room =
        rooms.get(socket.roomId);

      if (!room) return;

      const actor =
        room.users.get(socket.id);

      if (!actor || actor.role !== "host") {
        return callback?.({
          success: false,
          message: "Host qofa."
        });
      }

      const target =
        room.users.get(targetId);

      if (!target) return;

      target.muted = false;

      if (target.seat) {
        const seat =
          room.seats.find(
            s =>
              s.number === target.seat
          );

        if (seat) {
          seat.muted = false;
        }
      }

      io.to(targetId).emit(
        "unmuted-by-host"
      );

      callback?.({
        success: true
      });

      broadcastClassroom(room);
    }
  );

  /* =========================
     MAKE TEACHER
  ========================= */

  socket.on(
    "make-teacher",
    (
      { userId },
      callback
    ) => {

      const room =
        rooms.get(socket.roomId);

      if (!room) return;

      const actor =
        room.users.get(socket.id);

      if (!actor || actor.role !== "host") {
        return callback?.({
          success: false,
          message: "Host qofa."
        });
      }

      const target =
        room.users.get(userId);

      if (!target) return;

      target.role = "teacher";

      room.teacherId =
        target.id;

      io.to(target.id).emit(
        "became-teacher"
      );

      callback?.({
        success: true
      });

      broadcastClassroom(room);
    }
  );

  /* =========================
     REMOVE USER
  ========================= */

  socket.on(
    "remove-user",
    (
      targetId,
      callback
    ) => {

      const room =
        rooms.get(socket.roomId);

      if (!room) return;

      const actor =
        room.users.get(socket.id);

      if (!actor || actor.role !== "host") {
        return callback?.({
          success: false,
          message: "Host qofa."
        });
      }

      const target =
        room.users.get(targetId);

      if (!target) return;

      if (target.seat) {
        const seat =
          room.seats.find(
            s =>
              s.number === target.seat
          );

        if (seat) {
          seat.userId = null;
          seat.username = null;
          seat.role = null;
          seat.mic = false;
          seat.muted = false;
        }
      }

      room.users.delete(targetId);

      room.raisedHands =
        room.raisedHands.filter(
          id => id !== targetId
        );

      const targetSocket =
        io.sockets.sockets.get(
          targetId
        );

      if (targetSocket) {
        targetSocket.emit(
          "removed-from-room"
        );

        targetSocket.leave(
          room.id
        );

        targetSocket.roomId = null;
      }

      callback?.({
        success: true
      });

      broadcastClassroom(room);
    }
  );

  /* =========================
     RAISE HAND
  ========================= */

  socket.on(
    "raise-hand",
    () => {

      const room =
        rooms.get(socket.roomId);

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
            id =>
              id !== socket.id
          );
      }

      broadcastClassroom(room);
    }
  );

  /* =========================
     LOWER HAND
  ========================= */

  socket.on(
    "lower-hand",
    () => {

      const room =
        rooms.get(socket.roomId);

      if (!room) return;

      const user =
        room.users.get(socket.id);

      if (!user) return;

      user.handRaised = false;

      room.raisedHands =
        room.raisedHands.filter(
          id =>
            id !== socket.id
        );

      broadcastClassroom(room);
    }
  );

  /* =========================
     CHAT
  ========================= */

  socket.on(
    "chat-message",
    data => {

      const room =
        rooms.get(socket.roomId);

      if (!room) return;

      const message =
        String(
          data?.message || ""
        ).trim();

      if (!message) return;

      const chat = {
        id: Date.now().toString(),
        username:
          socket.username,
        message,
        time:
          new Date().toISOString()
      };

      room.messages.push(chat);

      if (room.messages.length > 200) {
        room.messages.shift();
      }

      io.to(room.id).emit(
        "chat-message",
        chat
      );
    }
  );

  /* =========================
     TYPING
  ========================= */

  socket.on(
    "typing",
    () => {

      if (!socket.roomId) return;

      socket.to(
        socket.roomId
      ).emit(
        "typing",
        {
          username:
            socket.username
        }
      );
    }
  );

  /* =========================
     WEBRTC OFFER
  ========================= */

  socket.on(
    "offer",
    data => {

      if (!data?.target) return;

      io.to(
        data.target
      ).emit(
        "offer",
        {
          sender:
            socket.id,
          offer:
            data.offer
        }
      );
    }
  );

  /* =========================
     WEBRTC ANSWER
  ========================= */

  socket.on(
    "answer",
    data => {

      if (!data?.target) return;

      io.to(
        data.target
      ).emit(
        "answer",
        {
          sender:
            socket.id,
          answer:
            data.answer
        }
      );
    }
  );

  /* =========================
     ICE CANDIDATE
  ========================= */

  socket.on(
    "ice-candidate",
    data => {

      if (!data?.target) return;

      io.to(
        data.target
      ).emit(
        "ice-candidate",
        {
          sender:
            socket.id,
          candidate:
            data.candidate
        }
      );
    }
  );

  /* =========================
     SCREEN SHARE
  ========================= */

  socket.on(
    "screen-share",
    data => {

      if (!socket.roomId) return;

      socket.to(
        socket.roomId
      ).emit(
        "screen-share",
        {
          socketId:
            socket.id,
          active:
            Boolean(data?.active)
        }
      );
    }
  );

  /* =========================
     GIFTS
  ========================= */

  socket.on(
    "sendGift",
    data => {

      if (!socket.roomId) return;

      const gifts = {
        heart: {
          emoji: "❤️",
          coins: 10
        },

        flower: {
          emoji: "🌹",
          coins: 20
        },

        star: {
          emoji: "⭐",
          coins: 50
        },

        crown: {
          emoji: "👑",
          coins: 100
        },

        diamond: {
          emoji: "💎",
          coins: 500
        }
      };

      const selected =
        gifts[data?.gift] ||
        gifts.heart;

      const giftData = {
        sender:
          socket.username,

        gift:
          data?.gift ||
          "heart",

        emoji:
          selected.emoji,

        coins:
          selected.coins,

        room:
          socket.roomId,

        time:
          new Date().toISOString()
      };

      const room =
        rooms.get(
          socket.roomId
        );

      if (room) {
        room.gifts.push(
          giftData
        );

        if (room.gifts.length > 100) {
          room.gifts.shift();
        }
      }

      io.to(
        socket.roomId
      ).emit(
        "giftReceived",
        giftData
      );
    }
  );

  /* =========================
     CALL START
  ========================= */

  socket.on(
    "call-start",
    ({
      targetId,
      callType
    }) => {

      if (!targetId) return;

      io.to(
        targetId
      ).emit(
        "incoming-call",
        {
          callerId:
            socket.id,

          caller:
            socket.username,

          callType:
            callType || "video"
        }
      );
    }
  );

  /* =========================
     CALL END
  ========================= */

  socket.on(
    "call-end",
    ({
      targetId
    }) => {

      if (!targetId) return;

      io.to(
        targetId
      ).emit(
        "call-ended",
        {
          callerId:
            socket.id
        }
      );
    }
  );

  /* =========================
     LEAVE ROOM
  ========================= */

  socket.on(
    "leave-room",
    () => {

      removeSocketFromRoom(
        socket
      );
    }
  );

  /* =========================
     DISCONNECT
  ========================= */

  socket.on(
    "disconnect",
    () => {

      console.log(
        "User disconnected:",
        socket.id
      );

      removeSocketFromRoom(
        socket
      );
    }
  );
});

/* =========================
   REMOVE SOCKET FROM ROOM
========================= */

function removeSocketFromRoom(socket) {

  const roomId =
    socket.roomId;

  if (!roomId) return;

  const room =
    rooms.get(roomId);

  if (!room) return;

  const user =
    room.users.get(
      socket.id
    );

  if (!user) return;

  /* RELEASE SEAT */

  if (user.seat) {

    const seat =
      room.seats.find(
        s =>
          s.number === user.seat
      );

    if (seat) {

      seat.userId = null;
      seat.username = null;
      seat.role = null;
      seat.mic = false;
      seat.muted = false;
    }
  }

  /* REMOVE HAND */

  room.raisedHands =
    room.raisedHands.filter(
      id =>
        id !== socket.id
    );

  /* REMOVE USER */

  room.users.delete(
    socket.id
  );

  socket.to(
    roomId
  ).emit(
    "user-left",
    socket.id
  );

  /*
    HOST LEAVES:
    Transfer host to another user.
  */

  if (
    room.hostId === socket.id
  ) {

    const next =
      Array.from(
        room.users.entries()
      )[0];

    if (next) {

      const [
        nextId,
        nextUser
      ] = next;

      nextUser.role =
        "host";

      room.hostId =
        nextId;

      io.to(nextId).emit(
        "became-host"
      );

    } else {

      rooms.delete(
        roomId
      );

      return;
    }
  }

  broadcastClassroom(room);
}

/* =========================
   FRONTEND
========================= */

app.get(
  "*",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);

/* =========================
   START
========================= */

async function startServer() {

  await initDatabase();

  server.listen(
    PORT,
    () => {

      console.log(
        `Waliin-JM running on port ${PORT}`
      );

    }
  );
}

startServer();
