import {
  GameError,
  TIMERS,
  CHAT,
  createRoom,
  addPlayer,
  removePlayer,
  markDisconnected,
  markReconnected,
  excludePlayer,
  getPlayer,
  startGame,
  submitAnswer,
  answerTimeout,
  submitVote,
  voteTimeout,
  validateMessageText,
  isWithinRateLimit,
} from '../game/index.js';
import { generateRoomCode, createRoomEntry, getEntry, setEntry, deleteEntry } from './store.js';
import { setTimer, clearTimer, clearAllTimers, setGraceTimer, clearGraceTimer } from './timers.js';
import { fetchQuestionBank } from './questions.js';
import { buildSnapshot } from './snapshot.js';
import { verifyToken } from '../auth/token.js';

function errorResponse(err, extra = {}) {
  if (err instanceof GameError) {
    return { ok: false, code: err.code, message: err.message, details: err.details, ...extra };
  }
  console.error('Erreur socket inattendue:', err.code || err.name || 'erreur inconnue');
  return { ok: false, code: 'INTERNAL_ERROR', message: 'Erreur interne', ...extra };
}

function requireEntry(socket) {
  const code = socket.data.roomCode;
  const entry = code ? getEntry(code) : null;
  if (!entry) {
    throw new GameError('NOT_IN_ROOM', "Vous n'êtes dans aucun salon");
  }
  return entry;
}

function broadcastPlayers(io, entry) {
  io.to(entry.room.code).emit('room:players', {
    players: entry.room.players,
    hostId: entry.room.hostId,
  });
}

function applyGameEffects(io, entry, effects) {
  for (const effect of effects) {
    switch (effect.type) {
      case 'TURN_STARTED':
        io.to(entry.room.code).emit('turn:started', {
          turnNumber: effect.turnNumber,
          activePlayerId: effect.activePlayerId,
          type: effect.questionType,
          questionId: effect.questionId,
          contenu: entry.questionsById.get(effect.questionId) ?? null,
        });
        break;
      case 'ANSWER_SUBMITTED':
        io.to(entry.room.code).emit('turn:answered', {
          turnNumber: effect.turnNumber,
          playerId: effect.playerId,
          answer: effect.answer,
        });
        break;
      case 'VOTE_SUBMITTED':
        io.to(entry.room.code).emit('turn:voted', {
          turnNumber: effect.turnNumber,
          voterId: effect.voterId,
        });
        break;
      case 'TURN_RESOLVED':
        io.to(entry.room.code).emit('turn:resolved', {
          turnNumber: effect.turnNumber,
          playerId: effect.playerId,
          points: effect.points,
          votes: effect.votes,
          players: entry.room.players,
        });
        break;
      case 'GAME_ENDED':
        clearAllTimers(entry);
        io.to(entry.room.code).emit('game:ended', {
          reason: effect.reason,
          ranking: effect.ranking,
        });
        break;
      case 'START_TIMER':
        setTimer(entry, effect.name, effect.turnNumber, effect.durationMs, () =>
          handleTimerFire(io, entry, effect.name, effect.turnNumber)
        );
        break;
      case 'CLEAR_TIMER':
        clearTimer(entry, effect.name);
        break;
      default:
        break;
    }
  }
}

function handleTimerFire(io, entry, name, turnNumber) {
  try {
    const fn = name === 'answer' ? answerTimeout : voteTimeout;
    const { room, effects } = fn(entry.room, { turnNumber });
    entry.room = room;
    applyGameEffects(io, entry, effects);
  } catch (err) {
    if (!(err instanceof GameError)) {
      console.error('Erreur timer inattendue:', err.code || err.name || 'erreur inconnue');
    }
  }
}

function cleanupIfEmpty(entry, code) {
  if (entry.room.players.length === 0) {
    clearAllTimers(entry);
    for (const playerId of [...entry.graceTimers.keys()]) {
      clearGraceTimer(entry, playerId);
    }
    deleteEntry(code);
  }
}

export function registerSocketHandlers(io) {
  io.use((socket, next) => {
    const { token } = socket.handshake.auth ?? {};
    if (typeof token !== 'string' || !token) {
      return next(new Error('AUTH_REQUIRED'));
    }
    try {
      const { id, pseudo } = verifyToken(token);
      socket.data.playerId = String(id);
      socket.data.pseudo = pseudo;
      next();
    } catch {
      next(new Error('INVALID_TOKEN'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('room:create', (payload, ack) => {
      try {
        const { maxTurns = null, targetScore = null } = payload ?? {};
        const code = generateRoomCode();
        const room = createRoom({
          code,
          hostId: socket.data.playerId,
          hostPseudo: socket.data.pseudo,
          maxTurns,
          targetScore,
        });
        const entry = createRoomEntry(room);
        entry.sockets.set(socket.data.playerId, socket.id);
        setEntry(code, entry);

        socket.join(code);
        socket.data.roomCode = code;

        ack?.({ ok: true, snapshot: buildSnapshot(entry) });
      } catch (err) {
        ack?.(errorResponse(err));
      }
    });

    socket.on('room:join', (payload, ack) => {
      try {
        const { code } = payload ?? {};
        const entry = getEntry(String(code ?? '').toUpperCase());
        if (!entry) throw new GameError('ROOM_NOT_FOUND', 'Salon introuvable');

        entry.room = addPlayer(entry.room, { id: socket.data.playerId, pseudo: socket.data.pseudo });
        entry.sockets.set(socket.data.playerId, socket.id);

        socket.join(entry.room.code);
        socket.data.roomCode = entry.room.code;

        broadcastPlayers(io, entry);
        ack?.({ ok: true, snapshot: buildSnapshot(entry) });
      } catch (err) {
        ack?.(errorResponse(err));
      }
    });

    socket.on('room:rejoin', (payload, ack) => {
      try {
        const { code } = payload ?? {};
        const entry = getEntry(String(code ?? '').toUpperCase());
        if (!entry) throw new GameError('ROOM_NOT_FOUND', 'Salon introuvable');

        const player = getPlayer(entry.room, socket.data.playerId);
        if (!player) throw new GameError('PLAYER_NOT_FOUND', 'Vous ne faites pas partie de ce salon');

        clearGraceTimer(entry, socket.data.playerId);
        entry.room = markReconnected(entry.room, socket.data.playerId);
        entry.sockets.set(socket.data.playerId, socket.id);

        socket.join(entry.room.code);
        socket.data.roomCode = entry.room.code;

        broadcastPlayers(io, entry);
        ack?.({ ok: true, snapshot: buildSnapshot(entry) });
      } catch (err) {
        ack?.(errorResponse(err));
      }
    });

    socket.on('room:leave', (_, ack) => {
      try {
        const entry = requireEntry(socket);
        const code = entry.room.code;

        entry.room = removePlayer(entry.room, socket.data.playerId);
        entry.sockets.delete(socket.data.playerId);
        socket.leave(code);
        socket.data.roomCode = null;

        if (entry.room.players.length > 0) {
          broadcastPlayers(io, entry);
        }
        cleanupIfEmpty(entry, code);

        ack?.({ ok: true });
      } catch (err) {
        ack?.(errorResponse(err));
      }
    });

    socket.on('game:start', async (_, ack) => {
      try {
        const entry = requireEntry(socket);
        if (entry.room.hostId !== socket.data.playerId) {
          throw new GameError('NOT_HOST', "Seul l'hôte peut lancer la partie");
        }

        const { questionPool, byId } = await fetchQuestionBank({ niveauMax: 1 });
        entry.questionsById = byId;

        const { room, effects } = startGame(entry.room, { questionPool });
        entry.room = room;

        io.to(entry.room.code).emit('game:started', { snapshot: buildSnapshot(entry) });
        applyGameEffects(io, entry, effects);

        ack?.({ ok: true });
      } catch (err) {
        ack?.(errorResponse(err));
      }
    });

    socket.on('turn:answer', (payload, ack) => {
      try {
        const entry = requireEntry(socket);
        const { text } = payload ?? {};
        const { room, effects } = submitAnswer(entry.room, { playerId: socket.data.playerId, text });
        entry.room = room;
        applyGameEffects(io, entry, effects);
        ack?.({ ok: true });
      } catch (err) {
        ack?.(errorResponse(err));
      }
    });

    socket.on('turn:vote', (payload, ack) => {
      try {
        const entry = requireEntry(socket);
        const { vote } = payload ?? {};
        const turnNumber = entry.room.currentTurn?.turnNumber;
        const { room, effects } = submitVote(entry.room, {
          voterId: socket.data.playerId,
          vote,
          turnNumber,
        });
        entry.room = room;
        applyGameEffects(io, entry, effects);
        ack?.({ ok: true });
      } catch (err) {
        ack?.(errorResponse(err));
      }
    });

    socket.on('chat:send', (payload, ack) => {
      const clientId = payload?.clientId;
      try {
        const entry = requireEntry(socket);
        const trimmed = validateMessageText(payload?.text);

        const now = Date.now();
        const timestamps = entry.chat.rateLimits.get(socket.data.playerId) ?? [];
        if (!isWithinRateLimit(timestamps, now)) {
          throw new GameError('RATE_LIMITED', 'Trop de messages, patientez un instant');
        }
        entry.chat.rateLimits.set(
          socket.data.playerId,
          [...timestamps.filter((t) => t > now - CHAT.rateLimit.windowMs), now]
        );

        const message = {
          id: entry.chat.nextMessageId++,
          playerId: socket.data.playerId,
          pseudo: socket.data.pseudo,
          text: trimmed,
          createdAt: now,
        };
        entry.chat.messages.push(message);
        if (entry.chat.messages.length > 200) entry.chat.messages.shift();

        io.to(entry.room.code).emit('chat:new', message);
        ack?.({ ok: true, clientId, message });
      } catch (err) {
        ack?.(errorResponse(err, { clientId }));
      }
    });

    socket.on('disconnect', () => {
      const code = socket.data.roomCode;
      if (!code) return;

      const entry = getEntry(code);
      if (!entry) return;
      if (entry.sockets.get(socket.data.playerId) !== socket.id) return; // une session plus récente a pris le relais

      entry.sockets.delete(socket.data.playerId);
      entry.room = markDisconnected(entry.room, socket.data.playerId);
      broadcastPlayers(io, entry);

      setGraceTimer(entry, socket.data.playerId, TIMERS.disconnectGraceMs, () => {
        if (entry.room.status === 'waiting') {
          entry.room = removePlayer(entry.room, socket.data.playerId);
        } else {
          entry.room = excludePlayer(entry.room, socket.data.playerId);
        }
        if (entry.room.players.length > 0) {
          broadcastPlayers(io, entry);
        }
        cleanupIfEmpty(entry, code);
      });
    });
  });
}
