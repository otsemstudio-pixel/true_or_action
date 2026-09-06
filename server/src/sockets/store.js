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
    dbRoomId: null, // id numérique en base (rooms.id) — la source d'autorité
    currentTurnDbId: null, // id de la ligne turns.* du tour en cours
    questionsById: new Map(),
    sockets: new Map(), // playerId -> socketId
    timers: new Map(), // name -> { handle, turnNumber, deadline }
    graceTimers: new Map(), // playerId -> { handle, deadline }
    chat: { messages: [], rateLimits: new Map() }, // les ids de message viennent de la base
    lock: null, // chaîne de promesses pour sérialiser les actions sur ce salon
  };
}

// Les écritures passent maintenant par la base (await), ce qui ouvre une
// fenêtre où deux actions concurrentes sur le même salon (ex: deux votes
// arrivant à quelques millisecondes d'écart sur deux sockets différentes)
// liraient toutes les deux l'ancien entry.room avant que la première n'ait
// fini d'écrire — la seconde écraserait alors le résultat de la première.
// runExclusive met en file les opérations d'un même salon pour qu'elles
// s'exécutent une par une, jamais entrelacées.
export function runExclusive(entry, fn) {
  const previous = entry.lock ?? Promise.resolve();
  const result = previous.then(fn, fn);
  entry.lock = result.catch(() => {});
  return result;
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
