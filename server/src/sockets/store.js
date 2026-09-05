const rooms = new Map();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I, ambigus à l'oral/écran

export function generateRoomCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

export function createRoomEntry(room) {
  return {
    room,
    questionsById: new Map(),
    sockets: new Map(), // playerId -> socketId
    timers: new Map(), // name -> { handle, turnNumber, deadline }
    graceTimers: new Map(), // playerId -> { handle, deadline }
    chat: { messages: [], rateLimits: new Map(), nextMessageId: 1 },
  };
}

export function getEntry(code) {
  return rooms.get(code) ?? null;
}

export function setEntry(code, entry) {
  rooms.set(code, entry);
}

export function deleteEntry(code) {
  rooms.delete(code);
}
