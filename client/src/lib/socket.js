import { io } from 'socket.io-client';
import { API_URL as SOCKET_URL } from './env.js';

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
    // WebSocket direct, jamais de handshake en polling HTTP : derrière
    // plusieurs instances serveur sans sessions collantes, les requêtes de
    // polling successives peuvent atterrir sur des instances différentes et
    // casser la connexion (symptôme trompeur : ça ressemble à du CORS).
    // Une connexion WebSocket unique et persistante n'a pas ce problème.
    transports: ['websocket'],
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
