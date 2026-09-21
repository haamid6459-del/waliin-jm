const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

/* DATABASE */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* MEMORY */

const rooms = new Map();

/* DATABASE SETUP */

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

/* SIGN UP */

app.post("/api/signup", async (req, res) => {
  try {
    const {
      username,
      email,
      password
    } = req.body;

    if (!username || !email || !password) {
      return res.json({
        success: false,
        message: "Username, email fi password guuti."
      });
    }

    if (password.length < 6) {
      return res.json({
        success: false,
        message:
          "Password yoo xiqqaate qubee 6 qabaachuu qaba."
      });
    }

    const cleanUsername =
      String(username).trim();

    const emailKey =
      String(email)
        .toLowerCase()
        .trim();

    const passwordHash =
      await bcrypt.hash(password, 12);

    await pool.query(
      `
      INSERT INTO users
      (username, email, password_hash)
      VALUES ($1, $2, $3)
      `,
      [
        cleanUsername,
        emailKey,
        passwordHash
      ]
    );

    res.json({
      success: true,
      message: "Account uumameera."
    });

  } catch (error) {

    if (error.code === "23505") {
      return res.json({
        success: false,
        message:
          "Email kun duraan account qaba."
      });
    }

    console.error(error);

    res.status(500).json({
      success: false,
      message:
        "Account uumuu irratti rakkoon uumame."
    });
  }
});

/* LOGIN */

app.post("/api/login", async (req, res) => {
  try {

    const {
      email,
      password
    } = req.body;

    const emailKey =
      String(email || "")
        .toLowerCase()
        .trim();

    const result =
      await pool.query(
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
        message:
          "Email ykn password sirrii miti."
      });
    }

    const user =
      result.rows[0];

    const passwordOK =
      await bcrypt.compare(
        password,
        user.password_hash
      );

    if (!passwordOK) {
      return res.json({
        success: false,
        message:
          "Email ykn password sirrii miti."
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
      message:
        "Login irratti rakkoon uumame."
    });
  }
});

/* USER PROFILE */

app.get("/api/user/:email", async (req, res) => {

  try {

    const email =
      String(req.params.email)
        .toLowerCase()
        .trim();

    const result =
      await pool.query(
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

/* STATUS */

app.get("/api/status", (req, res) => {

  res.json({
    app: "Waliin-JM",
    status: "online",
    rooms: rooms.size,
    unlimitedRooms: true,
    giftSystem: true,
    voiceClub: true,
    database:
      Boolean(process.env.DATABASE_URL)
  });
});

/* ROOM ID */

function generateRoomId() {

  return Math.random()
    .toString(36)
    .substring(2, 8)
    .toUpperCase();
}

/* PARTICIPANTS */

function getParticipants(room) {

  return [
    ...room.users.entries()
  ].map(
    ([socketId, user]) => ({
      socketId,
      username: user.username,
      isAdmin: user.isAdmin
    })
  );
}

/* SOCKET.IO */

io.on("connection", (socket) => {

  console.log(
    "User connected:",
    socket.id
  );

  /* CREATE ROOM */

  socket.on(
    "create-room",
    ({
      username,
      password = "",
      type = "video"
    }) => {

      const roomId =
        generateRoomId();

      rooms.set(roomId, {
        password,
        type,
        users: new Map(),
        gifts: []
      });

      const room =
        rooms.get(roomId);

      room.users.set(
        socket.id,
        {
          username,
          isAdmin: true
        }
      );

      socket.join(roomId);

      socket.roomId =
        roomId;

      socket.username =
        username;

      socket.isAdmin =
        true;

      socket.roomType =
        type;

      socket.emit(
        "room-created",
        {
          roomId,
          username,
          type
        }
      );

      io.to(roomId).emit(
        "participants",
        getParticipants(room)
      );
    }
  );

  /* JOIN ROOM */

  socket.on(
    "join-room",
    ({
      roomId,
      username,
      password = ""
    }) => {

      const room =
        rooms.get(roomId);

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

      /* NO USER LIMIT */

      const existingUsers =
        getParticipants(room);

      room.users.set(
        socket.id,
        {
          username,
          isAdmin: false
        }
      );

      socket.join(roomId);

      socket.roomId =
        roomId;

      socket.username =
        username;

      socket.isAdmin =
        false;

      socket.roomType =
        room.type;

      socket.emit(
        "room-joined",
        {
          roomId,
          username,
          type: room.type,
          users: existingUsers
        }
      );

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
    }
  );

  /* CHAT */

  socket.on(
    "chat-message",
    (data) => {

      if (!socket.roomId) return;

      io.to(socket.roomId).emit(
        "chat-message",
        {
          username:
            socket.username,
          message:
            String(data.message || ""),
          time:
            new Date()
              .toLocaleTimeString()
        }
      );
    }
  );

  /* TYPING */

  socket.on(
    "typing",
    () => {

      if (!socket.roomId)
        return;

      socket
        .to(socket.roomId)
        .emit(
          "typing",
          {
            username:
              socket.username
          }
        );
    }
  );

  /* WEBRTC OFFER */

  socket.on(
    "offer",
    (data) => {

      if (!data.target)
        return;

      io.to(data.target).emit(
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

  /* WEBRTC ANSWER */

  socket.on(
    "answer",
    (data) => {

      if (!data.target)
        return;

      io.to(data.target).emit(
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

  /* ICE */

  socket.on(
    "ice-candidate",
    (data) => {

      if (!data.target)
        return;

      io.to(data.target).emit(
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

  /* MUTE USER */

  socket.on(
    "mute-user",
    (targetId) => {

      if (!socket.isAdmin)
        return;

      if (!socket.roomId)
        return;

      io.to(targetId).emit(
        "force-mute"
      );
    }
  );

  /* REMOVE USER */

  socket.on(
    "remove-user",
    (targetId) => {

      if (!socket.isAdmin)
        return;

      const room =
        rooms.get(
          socket.roomId
        );

      if (!room)
        return;

      const target =
        io.sockets.sockets.get(
          targetId
        );

      if (target) {

        target.emit(
          "removed-from-room"
        );

        target.leave(
          socket.roomId
        );

        target.roomId =
          null;
      }

      room.users.delete(
        targetId
      );

      io.to(
        socket.roomId
      ).emit(
        "participants",
        getParticipants(room)
      );
    }
  );

  /* =========================
     🎁 GIFT SYSTEM
     ========================= */

  socket.on(
    "sendGift",
    async (data) => {

      if (!socket.roomId)
        return;

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
        gifts[data.gift] ||
        gifts.heart;

      const giftData = {

        sender:
          socket.username,

        gift:
          data.gift ||
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

        if (
          room.gifts.length > 100
        ) {
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
     🎙️ VOICE CLUB
     ========================= */

  socket.on(
    "voice-club-join",
    ({ roomId, username }) => {

      const room =
        rooms.get(roomId);

      if (!room)
        return;

      socket.join(roomId);

      socket.roomId =
        roomId;

      socket.username =
        username;

      socket.roomType =
        "voice-club";

      socket.to(roomId).emit(
        "voice-club-user-joined",
        {
          socketId:
            socket.id,
          username
        }
      );

      io.to(roomId).emit(
        "participants",
        getParticipants(room)
      );
    }
  );

  /* RAISE HAND */

  socket.on(
    "raise-hand",
    () => {

      if (!socket.roomId)
        return;

      io.to(
        socket.roomId
      ).emit(
        "hand-raised",
        {
          socketId:
            socket.id,
          username:
            socket.username
        }
      );
    }
  );

  /* LOWER HAND */

  socket.on(
    "lower-hand",
    () => {

      if (!socket.roomId)
        return;

      io.to(
        socket.roomId
      ).emit(
        "hand-lowered",
        {
          socketId:
            socket.id
        }
      );
    }
  );

  /* SCREEN SHARE */

  socket.on(
    "screen-share",
    (data) => {

      if (!socket.roomId)
        return;

      socket
        .to(socket.roomId)
        .emit(
          "screen-share",
          {
            socketId:
              socket.id,
            active:
              Boolean(data.active)
          }
        );
    }
  );

  /* CALL START */

  socket.on(
    "call-start",
    ({ targetId, callType }) => {

      if (!targetId)
        return;

      io.to(targetId).emit(
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

  /* CALL END */

  socket.on(
    "call-end",
    ({ targetId }) => {

      if (!targetId)
        return;

      io.to(targetId).emit(
        "call-ended",
        {
          callerId:
            socket.id
        }
      );
    }
  );

  /* DISCONNECT */

  socket.on(
    "disconnect",
    () => {

      console.log(
        "User disconnected:",
        socket.id
      );

      const roomId =
        socket.roomId;

      if (!roomId)
        return;

      const room =
        rooms.get(roomId);

      if (!room)
        return;

      room.users.delete(
        socket.id
      );

      socket
        .to(roomId)
        .emit(
          "user-left",
          socket.id
        );

      if (
        room.users.size === 0
      ) {

        rooms.delete(
          roomId
        );

      } else {

        io.to(roomId).emit(
          "participants",
          getParticipants(room)
        );
      }
    }
  );
});

/* FRONTEND */

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

/* START */

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
