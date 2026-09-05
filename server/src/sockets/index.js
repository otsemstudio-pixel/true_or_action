export function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`Socket connecté: ${socket.id}`);

    socket.on('disconnect', () => {
      console.log(`Socket déconnecté: ${socket.id}`);
    });
  });
}
