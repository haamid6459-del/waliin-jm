i
    if (!user) return;

    /* Release seat */

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

    room.users.delete(socket.id);

    room.raisedHands =
      room.raisedHands.filter(
        id => id !== socket.id
      );

    /* Teacher leaves */

    if (room.teacherId === socket.id) {
      room.teacherId = null;
    }

    /* Host leaves */

    if (room.hostId === socket.id) {

      const nextUser =
        room.users.values().next().value;

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
  });
});

/* =========================
   START
========================= */

async function startServer() {

  await console.log(
  "DATABASE_URL:",
  process.env.DATABASE_URL
    ? "DATABASE_URL FOUND"
    : "DATABASE_URL NOT FOUND"
);initDatabase();

  server.listen(PORT, () => {
    console.log(
      `WALIIN JM server running on port ${PORT}`
    );
  });
}

startServer();
