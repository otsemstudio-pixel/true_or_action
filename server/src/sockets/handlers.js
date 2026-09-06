import {
  GameError,
  TIMERS,
  CHAT,
  createRoom,
  updateSettings,
  addPlayer,
  removePlayer,
  restartRoom,
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
import { generateRoomCode, createRoomEntry, getEntry, setEntry, deleteEntry, runExclusive } from './store.js';
import { setTimer, clearTimer, clearAllTimers, setGraceTimer, clearGraceTimer } from './timers.js';
import { buildSnapshot } from './snapshot.js';
import { verifyToken } from '../auth/token.js';
import { pool, withTransaction } from '../db/pool.js';
import * as repo from '../db/repository.js';
import { persistEffects } from './persistence.js';
import { loadRoomEntryFromDb } from './reconstruct.js';

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

function enrichEffects(effects) {
  return effects.map((effect) => {
    if (effect.type === 'TURN_STARTED') {
      return { ...effect, answerDeadline: Date.now() + TIMERS.answerMs };
    }
    if (effect.type === 'ANSWER_SUBMITTED') {
      return { ...effect, voteDeadline: Date.now() + TIMERS.voteMs };
    }
    return effect;
  });
}

function broadcastEffects(io, entry, effects) {
  for (const effect of effects) {
    switch (effect.type) {
      case 'TURN_STARTED':
        io.to(entry.room.code).emit('turn:started', {
          turnNumber: effect.turnNumber,
          activePlayerId: effect.activePlayerId,
          type: effect.questionType,
          questionId: effect.questionId,
          contenu: entry.questionsById.get(effect.questionId) ?? null,
          answerDeadline: effect.answerDeadline,
        });
        break;
      case 'ANSWER_SUBMITTED':
        io.to(entry.room.code).emit('turn:answered', {
          turnNumber: effect.turnNumber,
          playerId: effect.playerId,
          answer: effect.answer,
          voteDeadline: effect.voteDeadline,
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
          runExclusive(entry, () => handleTimerFire(io, entry, effect.name, effect.turnNumber))
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

// Persiste puis diffuse un lot d'effets issus de src/game/turn.js. La mémoire
// (entry.room) n'est mise à jour qu'une fois l'écriture en base confirmée :
// en cas d'échec, le cache reste sur son ancien état cohérent avec la base.
export async function applyGameEffects(io, entry, newRoom, effects) {
  const enriched = enrichEffects(effects);
  const { newTurnDbId } = await withTransaction((client) => persistEffects(client, entry, newRoom, enriched));
  entry.room = newRoom;
  if (newTurnDbId) entry.currentTurnDbId = newTurnDbId;
  broadcastEffects(io, entry, enriched);
}

export async function handleTimerFire(io, entry, name, turnNumber) {
  try {
    const fn = name === 'answer' ? answerTimeout : voteTimeout;
    const { room, effects } = fn(entry.room, { turnNumber });
    await applyGameEffects(io, entry, room, effects);
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

// Fin de la fenêtre de grâce d'un joueur déconnecté (2 min) : retiré du salon
// s'il attendait encore (waiting), sinon marqué "left" et sorti de l'ordre des
// tours. Réutilisé tel quel au redémarrage pour les délais déjà expirés.
export async function expireGrace(io, entry, code, playerId) {
  entry.graceTimers.delete(playerId);
  const wasWaiting = entry.room.status === 'waiting';
  const updatedRoom = wasWaiting ? removePlayer(entry.room, playerId) : excludePlayer(entry.room, playerId);

  await withTransaction(async (client) => {
    if (wasWaiting) {
      await repo.deleteRoomPlayer(client, entry.dbRoomId, Number(playerId));
    } else {
      await repo.updatePlayerState(client, entry.dbRoomId, Number(playerId), 'left');
    }
  });

  entry.room = updatedRoom;
  if (entry.room.players.length > 0) {
    broadcastPlayers(io, entry);
  }
  cleanupIfEmpty(entry, code);
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
    socket.on('room:create', async (payload, ack) => {
      try {
        const { maxTurns = null, targetScore = null } = payload ?? {};
        const hostIdNum = Number(socket.data.playerId);

        // Valide les réglages avant de toucher la base (résultat jeté, on ne
        // veut que l'erreur éventuelle).
        createRoom({ code: '000000', hostId: socket.data.playerId, hostPseudo: socket.data.pseudo, maxTurns, targetScore });

        let code;
        let dbRoomId;
        for (let attempt = 0; attempt < 5; attempt++) {
          code = generateRoomCode();
          try {
            dbRoomId = await withTransaction(async (client) => {
              const id = await repo.insertRoom(client, {
                code,
                hostId: hostIdNum,
                maxTurns,
                targetScore,
                timeoutSec: TIMERS.answerMs / 1000,
                voteSec: TIMERS.voteMs / 1000,
              });
              await repo.insertRoomPlayer(client, id, hostIdNum);
              return id;
            });
            break;
          } catch (err) {
            if (err.code === '23505' && attempt < 4) continue;
            throw err;
          }
        }

        const room = createRoom({
          code,
          hostId: socket.data.playerId,
          hostPseudo: socket.data.pseudo,
          maxTurns,
          targetScore,
        });
        const entry = createRoomEntry(room);
        entry.dbRoomId = dbRoomId;
        entry.sockets.set(socket.data.playerId, socket.id);
        setEntry(code, entry);

        socket.join(code);
        socket.data.roomCode = code;

        ack?.({ ok: true, snapshot: buildSnapshot(entry) });
      } catch (err) {
        ack?.(errorResponse(err));
      }
    });

    socket.on('room:join', async (payload, ack) => {
      try {
        const { code } = payload ?? {};
        const entry = getEntry(String(code ?? '').toUpperCase());
        if (!entry) throw new GameError('ROOM_NOT_FOUND', 'Salon introuvable');

        await runExclusive(entry, async () => {
          const updatedRoom = addPlayer(entry.room, { id: socket.data.playerId, pseudo: socket.data.pseudo });
          await repo.insertRoomPlayer(pool, entry.dbRoomId, Number(socket.data.playerId));
          entry.room = updatedRoom;
        });

        entry.sockets.set(socket.data.playerId, socket.id);
        socket.join(entry.room.code);
        socket.data.roomCode = entry.room.code;

        broadcastPlayers(io, entry);
        ack?.({ ok: true, snapshot: buildSnapshot(entry) });
      } catch (err) {
        ack?.(errorResponse(err));
      }
    });

    socket.on('room:rejoin', async (payload, ack) => {
      try {
        const code = String(payload?.code ?? '').toUpperCase();
        const existingEntry = getEntry(code);
        if (!existingEntry) throw new GameError('ROOM_NOT_FOUND', 'Salon introuvable');

        const player = getPlayer(existingEntry.room, socket.data.playerId);
        if (!player) throw new GameError('PLAYER_NOT_FOUND', 'Vous ne faites pas partie de ce salon');

        const freshEntry = await runExclusive(existingEntry, async () => {
          await repo.updatePlayerState(pool, existingEntry.dbRoomId, Number(socket.data.playerId), 'active');

          // Le snapshot de reconnexion se construit toujours depuis la base,
          // jamais depuis le cache mémoire — celui-ci se resynchronise dessus.
          const roomRow = await repo.fetchRoomByCode(pool, code);
          if (!roomRow) throw new GameError('ROOM_NOT_FOUND', 'Salon introuvable');
          const { entry: reloaded } = await loadRoomEntryFromDb(roomRow);

          reloaded.sockets = existingEntry.sockets;
          reloaded.timers = existingEntry.timers;
          reloaded.graceTimers = existingEntry.graceTimers;
          reloaded.chat.rateLimits = existingEntry.chat.rateLimits;
          setEntry(code, reloaded);
          return reloaded;
        });
        freshEntry.lock = Promise.resolve(); // l'opération ci-dessus est terminée, la file repart à vide

        clearGraceTimer(freshEntry, socket.data.playerId);
        freshEntry.sockets.set(socket.data.playerId, socket.id);

        socket.join(code);
        socket.data.roomCode = code;

        broadcastPlayers(io, freshEntry);
        ack?.({ ok: true, snapshot: buildSnapshot(freshEntry) });
      } catch (err) {
        ack?.(errorResponse(err));
      }
    });

    socket.on('room:leave', async (_, ack) => {
      try {
        const entry = requireEntry(socket);
        const code = entry.room.code;

        await runExclusive(entry, async () => {
          const updatedRoom = removePlayer(entry.room, socket.data.playerId);
          const hostChanged = updatedRoom.hostId !== entry.room.hostId;

          await withTransaction(async (client) => {
            await repo.deleteRoomPlayer(client, entry.dbRoomId, Number(socket.data.playerId));
            if (hostChanged) {
              await repo.updateRoomHost(client, entry.dbRoomId, Number(updatedRoom.hostId));
            }
          });

          entry.room = updatedRoom;
        });

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

    socket.on('room:settings', async (payload, ack) => {
      try {
        const entry = requireEntry(socket);
        if (entry.room.hostId !== socket.data.playerId) {
          throw new GameError('NOT_HOST', "Seul l'hôte peut modifier les réglages");
        }
        const { maxTurns = null, targetScore = null } = payload ?? {};
        await runExclusive(entry, async () => {
          const updatedRoom = updateSettings(entry.room, { maxTurns, targetScore });
          await repo.updateRoomSettings(pool, entry.dbRoomId, { maxTurns, targetScore });
          entry.room = updatedRoom;
        });

        io.to(entry.room.code).emit('room:settings', { settings: entry.room.settings });
        ack?.({ ok: true, settings: entry.room.settings });
      } catch (err) {
        ack?.(errorResponse(err));
      }
    });

    socket.on('game:rematch', async (_, ack) => {
      try {
        const entry = requireEntry(socket);
        if (entry.room.hostId !== socket.data.playerId) {
          throw new GameError('NOT_HOST', "Seul l'hôte peut relancer une partie");
        }
        await runExclusive(entry, async () => {
          const updatedRoom = restartRoom(entry.room);

          await withTransaction(async (client) => {
            await repo.updateRoomStatus(client, entry.dbRoomId, 'waiting');
            await repo.resetRoomPlayersScores(client, entry.dbRoomId);
            await repo.deleteLeftPlayers(client, entry.dbRoomId);
          });

          entry.room = updatedRoom;
          entry.dbPartieId = null;
          entry.currentTurnDbId = null;
        });
        clearAllTimers(entry);

        io.to(entry.room.code).emit('game:restarted', { snapshot: buildSnapshot(entry) });
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

        const enriched = await runExclusive(entry, async () => {
          const { questionPool, byId } = await repo.fetchQuestionBank(pool, { niveauMax: 1 });
          const { room, effects } = startGame(entry.room, { questionPool });
          const effectsEnriched = enrichEffects(effects);

          const { newTurnDbId } = await withTransaction(async (client) => {
            await repo.updateRoomStatus(client, entry.dbRoomId, 'playing');
            entry.dbPartieId = await repo.insertPartie(client, entry.dbRoomId);
            return persistEffects(client, entry, room, effectsEnriched);
          });

          entry.questionsById = byId;
          entry.room = room;
          if (newTurnDbId) entry.currentTurnDbId = newTurnDbId;
          return effectsEnriched;
        });

        io.to(entry.room.code).emit('game:started', { snapshot: buildSnapshot(entry) });
        broadcastEffects(io, entry, enriched);

        ack?.({ ok: true });
      } catch (err) {
        ack?.(errorResponse(err));
      }
    });

    socket.on('turn:answer', async (payload, ack) => {
      try {
        const entry = requireEntry(socket);
        const { text } = payload ?? {};
        await runExclusive(entry, async () => {
          const { room, effects } = submitAnswer(entry.room, { playerId: socket.data.playerId, text });
          await applyGameEffects(io, entry, room, effects);
        });
        ack?.({ ok: true });
      } catch (err) {
        ack?.(errorResponse(err));
      }
    });

    socket.on('turn:vote', async (payload, ack) => {
      try {
        const entry = requireEntry(socket);
        const { vote } = payload ?? {};
        await runExclusive(entry, async () => {
          const turnNumber = entry.room.currentTurn?.turnNumber;
          const { room, effects } = submitVote(entry.room, {
            voterId: socket.data.playerId,
            vote,
            turnNumber,
          });
          await applyGameEffects(io, entry, room, effects);
        });
        ack?.({ ok: true });
      } catch (err) {
        ack?.(errorResponse(err));
      }
    });

    socket.on('chat:send', async (payload, ack) => {
      const clientId = payload?.clientId;
      try {
        const entry = requireEntry(socket);
        const trimmed = validateMessageText(payload?.text);

        const now = Date.now();
        const timestamps = entry.chat.rateLimits.get(socket.data.playerId) ?? [];
        if (!isWithinRateLimit(timestamps, now)) {
          throw new GameError('RATE_LIMITED', 'Trop de messages, patientez un instant');
        }

        const saved = await repo.insertMessage(pool, entry.dbRoomId, Number(socket.data.playerId), trimmed);

        entry.chat.rateLimits.set(
          socket.data.playerId,
          [...timestamps.filter((t) => t > now - CHAT.rateLimit.windowMs), now]
        );

        const message = {
          id: saved.id,
          playerId: socket.data.playerId,
          pseudo: socket.data.pseudo,
          text: trimmed,
          createdAt: new Date(saved.created_at).getTime(),
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

      // Pas d'ack possible sur une déconnexion : la mémoire est mise à jour
      // tout de suite (l'utilisateur doit voir l'effet immédiatement) et la
      // persistance suit en arrière-plan, toujours sérialisée avec le reste.
      runExclusive(entry, async () => {
        entry.room = markDisconnected(entry.room, socket.data.playerId);
        broadcastPlayers(io, entry);
        await repo.updatePlayerState(pool, entry.dbRoomId, Number(socket.data.playerId), 'disconnected');
      }).catch((err) => {
        console.error('Erreur persistance déconnexion:', err.code || err.name || 'erreur inconnue');
      });

      setGraceTimer(entry, socket.data.playerId, TIMERS.disconnectGraceMs, () => {
        runExclusive(entry, () => expireGrace(io, entry, code, socket.data.playerId)).catch((err) => {
          console.error('Erreur expiration grâce:', err.code || err.name || 'erreur inconnue');
        });
      });
    });
  });
}
