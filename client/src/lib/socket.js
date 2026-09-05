import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

let socket = null;

export function connectSocket(token) {
  if (socket) {
    socket.disconnect();
  }
  socket = io(SOCKET_URL, {
    auth: { token },
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 10000,
    randomizationFactor: 0.5,
  });
  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
