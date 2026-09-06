import {
  GameError,
  TIMERS,
  PLAYERS,
  REGLES_TIMERS,
  CHAT,
  createRoom,
  updateSettings,
  updateNiveauMax,
  updateAnswerSec,
  updateMaxPlayers,
  updateCategorie,
  updateLangue,
  updateRegles,
  effectiveRegles,
  addPlayer,
  removePlayer,
  restartRoom,
  markDisconnected,
  markReconnected,
  handlePlayerLeft,
  getPlayer,
  startGame,
  submitAnswer,
  answerTimeout,
  submitVote,
  voteTimeout,
  submitPass,
  respondDoubleOuRien,
  niveauChoiceTimeout,
  chooseQuestion,
  questionChoiceTimeout,
  returnQuestion,
  submitBet,
  judgeBet,
  judgeBetTimeout,
  submitSurpriseAnswer,
  surpriseAnswerTimeout,
  submitSurpriseVote,
  surpriseVoteTimeout,
  validateMessageText,
  isWithinRateLimit,
} from '../game/index.js';
import { generateRoomCode, createRoomEntry, getEntry, setEntry, deleteEntry, runExclusive } from './store.js';
import { setTimer, clearTimer, clearAllTimers, setGraceTimer, clearGraceTimer } from './timers.js';
import { buildSnapshot } from './snapshot.js';
import { verifyToken } from '../auth/token.js';
import { touchLastSeen } from '../auth/repository.js';
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
  // Le nombre de joueurs actifs conditionne le pari mutuel (effectiveRegles) :
  // rediffusé ici pour que l'affichage des règles actives reste à jour à
  // chaque arrivée/départ, pas seulement quand l'hôte touche aux règles.
  io.to(entry.room.code).emit('room:regles', { regles: effectiveRegles(entry.room) });
}

function enrichEffects(effects, room) {
  return effects.map((effect) => {
    if (effect.type === 'TURN_STARTED') {
      // room.answerSec est réglable par l'hôte (voir room:timeout) : jamais
      // la constante TIMERS.answerMs, qui ne sert plus que de valeur par
      // défaut à la création d'un salon.
      return { ...effect, answerDeadline: Date.now() + room.answerSec * 1000 };
    }
    if (effect.type === 'ANSWER_SUBMITTED') {
      return { ...effect, voteDeadline: Date.now() + TIMERS.voteMs };
    }
    if (effect.type === 'NIVEAU_CHOICE_OFFERED') {
      return { ...effect, deadline: Date.now() + REGLES_TIMERS.niveauChoiceMs };
    }
    if (effect.type === 'QUESTION_CHOICE_OFFERED') {
      return { ...effect, deadline: Date.now() + REGLES_TIMERS.questionChoiceMs };
    }
    if (effect.type === 'JUGEMENT_STARTED') {
      return { ...effect, deadline: Date.now() + REGLES_TIMERS.jugementMs };
    }
    if (effect.type === 'SURPRISE_VOTING_STARTED') {
      return { ...effect, voteDeadline: Date.now() + TIMERS.voteMs };
    }
    return effect;
  });
}

function broadcastEffects(io, entry, effects, newAnswerMessage = null) {
  for (const effect of effects) {
    switch (effect.type) {
      case 'TURN_STARTED':
        if (effect.mode === 'surprise') {
          io.to(entry.room.code).emit('turn:started', {
            turnNumber: effect.turnNumber,
            mode: 'surprise',
            activePlayerIds: effect.activePlayerIds,
            type: effect.questionType,
            questionId: effect.questionId,
            contenu: entry.questionsById.get(effect.questionId) ?? null,
            answerDeadline: effect.answerDeadline,
          });
        } else {
          io.to(entry.room.code).emit('turn:started', {
            turnNumber: effect.turnNumber,
            mode: 'normal',
            activePlayerId: effect.activePlayerId,
            type: effect.questionType,
            questionId: effect.questionId,
            contenu: entry.questionsById.get(effect.questionId) ?? null,
            answerDeadline: effect.answerDeadline,
            doubleOuRien: Boolean(effect.doubleOuRien),
          });
        }
        break;
      case 'ANSWER_SUBMITTED':
        io.to(entry.room.code).emit('turn:answered', {
          turnNumber: effect.turnNumber,
          playerId: effect.playerId,
          answer: effect.answer,
          voteDeadline: effect.voteDeadline,
        });
        // La réponse est aussi un message ordinaire (voir persistence.js) :
        // diffusé via le canal chat existant, pour rester citable comme
        // n'importe quel autre message.
        if (newAnswerMessage) {
          io.to(entry.room.code).emit('chat:new', newAnswerMessage);
        }
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
          doubleOuRien: Boolean(effect.doubleOuRien),
          pariMutuel: effect.pariMutuel ?? null,
        });
        break;
      case 'GAME_ENDED':
        clearAllTimers(entry);
        io.to(entry.room.code).emit('game:ended', {
          reason: effect.reason,
          ranking: effect.ranking,
        });
        break;

      // ---------- Règle A : le refus qui coûte ----------
      case 'PASS_SUBMITTED':
        io.to(entry.room.code).emit('turn:passed', {
          turnNumber: effect.turnNumber,
          playerId: effect.playerId,
          points: effect.points,
          players: entry.room.players,
        });
        break;
      case 'QUESTION_CHOICE_OFFERED':
        io.to(entry.room.code).emit('turn:questionChoiceOffered', {
          turnNumber: effect.turnNumber,
          activePlayerId: effect.activePlayerId,
          choices: effect.choices.map((c) => ({
            questionId: c.questionId,
            type: c.type,
            contenu: entry.questionsById.get(c.questionId) ?? null,
          })),
          deadline: effect.deadline,
        });
        break;

      // ---------- Règle B : le double ou rien ----------
      case 'NIVEAU_CHOICE_OFFERED':
        io.to(entry.room.code).emit('turn:niveauChoiceOffered', {
          turnNumber: effect.turnNumber,
          activePlayerId: effect.activePlayerId,
          deadline: effect.deadline,
        });
        break;

      // ---------- Règle C : la question retournée ----------
      case 'QUESTION_RETURNED':
        io.to(entry.room.code).emit('turn:questionReturned', {
          turnNumber: effect.turnNumber,
          fromPlayerId: effect.fromPlayerId,
          toPlayerId: effect.toPlayerId,
        });
        break;

      // ---------- Règle E : le pari mutuel ----------
      // (submitBet ne produit lui-même aucun effet : le pari reste caché du
      // joueur actif jusqu'à ce qu'il ait répondu — voir game/turn.js)
      case 'JUGEMENT_STARTED':
        io.to(entry.room.code).emit('turn:jugementStarted', {
          turnNumber: effect.turnNumber,
          bettorId: effect.bettorId,
          bet: effect.bet,
          deadline: effect.deadline,
        });
        break;

      // ---------- Règle D : le tour surprise ----------
      case 'SURPRISE_ANSWER_SUBMITTED':
        // Le contenu de la réponse reste caché des autres jusqu'au vote —
        // seul un accusé "a répondu" est diffusé pour la progression.
        io.to(entry.room.code).emit('turn:surpriseAnswered', {
          turnNumber: effect.turnNumber,
          playerId: effect.playerId,
        });
        break;
      case 'SURPRISE_VOTING_STARTED':
        io.to(entry.room.code).emit('turn:surpriseVotingStarted', {
          turnNumber: effect.turnNumber,
          answers: effect.answers,
          voteDeadline: effect.voteDeadline,
        });
        break;
      case 'SURPRISE_VOTE_SUBMITTED':
        io.to(entry.room.code).emit('turn:surpriseVoted', {
          turnNumber: effect.turnNumber,
          voterId: effect.voterId,
        });
        break;
      case 'SURPRISE_RESOLVED':
        io.to(entry.room.code).emit('turn:resolved', {
          turnNumber: effect.turnNumber,
          mode: 'surprise',
          results: effect.results,
          winnerIds: effect.winnerIds,
          players: entry.room.players,
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
  const enriched = enrichEffects(effects, newRoom);
  const { newTurnDbId, newAnswerMessage } = await withTransaction((client) =>
    persistEffects(client, entry, newRoom, enriched)
  );
  entry.room = newRoom;
  if (newTurnDbId) entry.currentTurnDbId = newTurnDbId;
  if (newAnswerMessage) {
    entry.chat.messages.push(newAnswerMessage);
    if (entry.chat.messages.length > 200) entry.chat.messages.shift();
  }
  broadcastEffects(io, entry, enriched, newAnswerMessage);
}

// Une fois le mode du tour connu, "answer"/"vote" ne pointent pas toujours
// vers la même fonction pure : un tour surprise a ses propres timeouts.
function resolveTimeoutHandler(entry, name) {
  const isSurprise = entry.room.currentTurn?.mode === 'surprise';
  switch (name) {
    case 'answer':
      return isSurprise ? surpriseAnswerTimeout : answerTimeout;
    case 'vote':
      return isSurprise ? surpriseVoteTimeout : voteTimeout;
    case 'niveau_choice':
      return niveauChoiceTimeout;
    case 'question_choice':
      return questionChoiceTimeout;
    case 'jugement':
      return judgeBetTimeout;
    default:
      return null;
  }
}

export async function handleTimerFire(io, entry, name, turnNumber) {
  try {
    const fn = resolveTimeoutHandler(entry, name);
    if (!fn) return;
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

  if (wasWaiting) {
    const updatedRoom = removePlayer(entry.room, playerId);
    await repo.deleteRoomPlayer(pool, entry.dbRoomId, Number(playerId));
    entry.room = updatedRoom;
  } else {
    // En partie : si un seul joueur reste après exclusion, handlePlayerLeft
    // termine la partie immédiatement (effects contient alors GAME_ENDED et
    // les CLEAR_TIMER correspondants) — sinon effects est vide.
    const { room: updatedRoom, effects } = handlePlayerLeft(entry.room, playerId);
    await withTransaction(async (client) => {
      await repo.updatePlayerState(client, entry.dbRoomId, Number(playerId), 'left');
      await persistEffects(client, entry, updatedRoom, effects);
    });
    entry.room = updatedRoom;
    broadcastEffects(io, entry, effects);
  }

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
      const { id, pseudo, isGuest } = verifyToken(token);
      socket.data.playerId = String(id);
      socket.data.pseudo = pseudo;
      socket.data.isGuest = isGuest;
      // Un JWT d'invité se vérifie exactement comme un JWT normal (même
      // secret, même schéma) : rien de spécial à faire pour l'accepter ici.
      // On profite de la connexion pour repousser l'horloge d'inactivité
      // (nettoyage à 90 jours, voir auth/repository.js deleteInactiveGuests).
      if (isGuest) touchLastSeen(id).catch(() => {});
      next();
    } catch {
      next(new Error('INVALID_TOKEN'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('room:create', async (payload, ack) => {
      try {
        const { maxTurns = null, targetScore = null, langue = 'fr', maxPlayers = PLAYERS.defaultMax } = payload ?? {};
        const hostIdNum = Number(socket.data.playerId);

        // Valide les réglages avant de toucher la base (résultat jeté, on ne
        // veut que l'erreur éventuelle).
        createRoom({
          code: '000000',
          hostId: socket.data.playerId,
          hostPseudo: socket.data.pseudo,
          hostIsGuest: socket.data.isGuest,
          maxTurns,
          targetScore,
          langue,
          maxPlayers,
        });

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
                langue,
                maxPlayers,
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
          hostIsGuest: socket.data.isGuest,
          maxTurns,
          targetScore,
          langue,
          maxPlayers,
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
          const updatedRoom = addPlayer(entry.room, {
            id: socket.data.playerId,
            pseudo: socket.data.pseudo,
            isGuest: socket.data.isGuest,
          });
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

    socket.on('room:niveau', async (payload, ack) => {
      try {
        const entry = requireEntry(socket);
        if (entry.room.hostId !== socket.data.playerId) {
          throw new GameError('NOT_HOST', "Seul l'hôte peut modifier le niveau des questions");
        }
        const { niveauMax } = payload ?? {};
        await runExclusive(entry, async () => {
          const updatedRoom = updateNiveauMax(entry.room, niveauMax);
          await repo.updateRoomNiveauMax(pool, entry.dbRoomId, niveauMax);
          entry.room = updatedRoom;
        });

        io.to(entry.room.code).emit('room:niveau', { niveauMax: entry.room.niveauMax });
        ack?.({ ok: true, niveauMax: entry.room.niveauMax });
      } catch (err) {
        ack?.(errorResponse(err));
      }
    });

    // Temps de réponse (phase "answering"), réglable par l'hôte tant que le
    // salon attend ; le minuteur de vote, lui, reste fixe (pas de handler).
    socket.on('room:timeout', async (payload, ack) => {
      try {
        const entry = requireEntry(socket);
        if (entry.room.hostId !== socket.data.playerId) {
          throw new GameError('NOT_HOST', "Seul l'hôte peut modifier le temps de réponse");
        }
        const { answerSec } = payload ?? {};
        await runExclusive(entry, async () => {
          const updatedRoom = updateAnswerSec(entry.room, answerSec);
          await repo.updateRoomTimeoutSec(pool, entry.dbRoomId, answerSec);
          entry.room = updatedRoom;
        });

        io.to(entry.room.code).emit('room:timeout', { answerSec: entry.room.answerSec });
        ack?.({ ok: true, answerSec: entry.room.answerSec });
      } catch (err) {
        ack?.(errorResponse(err));
      }
    });

    socket.on('room:maxPlayers', async (payload, ack) => {
      try {
        const entry = requireEntry(socket);
        if (entry.room.hostId !== socket.data.playerId) {
          throw new GameError('NOT_HOST', "Seul l'hôte peut modifier le nombre maximum de joueurs");
        }
        const { maxPlayers } = payload ?? {};
        await runExclusive(entry, async () => {
          const updatedRoom = updateMaxPlayers(entry.room, maxPlayers);
          await repo.updateRoomMaxPlayers(pool, entry.dbRoomId, maxPlayers);
          entry.room = updatedRoom;
        });

        io.to(entry.room.code).emit('room:maxPlayers', { maxPlayers: entry.room.maxPlayers });
        ack?.({ ok: true, maxPlayers: entry.room.maxPlayers });
      } catch (err) {
        ack?.(errorResponse(err));
      }
    });

    // Mode couple : catégorie parallèle et exclusive à 'general', verrouillée
    // à 2 joueurs. Bascule le niveau à sa valeur par défaut et la limite de
    // joueurs en même temps (voir game/room.js updateCategorie) — les trois
    // colonnes sont donc réécrites ensemble en base et rediffusées ensemble.
    socket.on('room:categorie', async (payload, ack) => {
      try {
        const entry = requireEntry(socket);
        if (entry.room.hostId !== socket.data.playerId) {
          throw new GameError('NOT_HOST', "Seul l'hôte peut modifier la catégorie du salon");
        }
        const { categorie } = payload ?? {};
        await runExclusive(entry, async () => {
          const updatedRoom = updateCategorie(entry.room, categorie);
          await repo.updateRoomCategorie(pool, entry.dbRoomId, {
            categorie: updatedRoom.categorie,
            maxPlayers: updatedRoom.maxPlayers,
            niveauMax: updatedRoom.niveauMax,
          });
          entry.room = updatedRoom;
        });

        io.to(entry.room.code).emit('room:categorie', {
          categorie: entry.room.categorie,
          maxPlayers: entry.room.maxPlayers,
          niveauMax: entry.room.niveauMax,
          regles: effectiveRegles(entry.room),
        });
        ack?.({ ok: true, categorie: entry.room.categorie, maxPlayers: entry.room.maxPlayers, niveauMax: entry.room.niveauMax });
      } catch (err) {
        ack?.(errorResponse(err));
      }
    });

    socket.on('room:langue', async (payload, ack) => {
      try {
        const entry = requireEntry(socket);
        if (entry.room.hostId !== socket.data.playerId) {
          throw new GameError('NOT_HOST', "Seul l'hôte peut modifier la langue des questions");
        }
        const { langue } = payload ?? {};
        await runExclusive(entry, async () => {
          const updatedRoom = updateLangue(entry.room, langue);
          await repo.updateRoomLangue(pool, entry.dbRoomId, langue);
          entry.room = updatedRoom;
        });

        io.to(entry.room.code).emit('room:langue', { langue: entry.room.langue });
        ack?.({ ok: true, langue: entry.room.langue });
      } catch (err) {
        ack?.(errorResponse(err));
      }
    });

    // Point 3 : cinq règles optionnelles, host-only, modifiables seulement en
    // salon d'attente — visibles par tous une fois activées.
    socket.on('room:regles', async (payload, ack) => {
      try {
        const entry = requireEntry(socket);
        if (entry.room.hostId !== socket.data.playerId) {
          throw new GameError('NOT_HOST', "Seul l'hôte peut modifier les règles du jeu");
        }
        const regles = payload ?? {};
        await runExclusive(entry, async () => {
          const updatedRoom = updateRegles(entry.room, regles);
          await repo.updateRoomRegles(pool, entry.dbRoomId, updatedRoom.regles);
          entry.room = updatedRoom;
        });

        io.to(entry.room.code).emit('room:regles', { regles: effectiveRegles(entry.room) });
        ack?.({ ok: true, regles: effectiveRegles(entry.room) });
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
          const { questionPool, byId } = await repo.fetchQuestionBank(pool, {
            niveauMax: entry.room.niveauMax,
            langue: entry.room.langue,
            categorie: entry.room.categorie,
          });

          // Règle B : le double ou rien pioche dans le niveau juste au-dessus
          // du salon — jamais tiré tant que la règle n'est pas active, ni en
          // mode couple (effectiveRegles la masque déjà : pas de niveau
          // supérieur où piocher dans cette catégorie).
          if (effectiveRegles(entry.room).doubleOuRien && entry.room.niveauMax < 3) {
            const { questionPool: escaladeBank, byId: escaladeById } = await repo.fetchQuestionBank(pool, {
              niveauMax: entry.room.niveauMax + 1,
              langue: entry.room.langue,
              categorie: entry.room.categorie,
            });
            questionPool.escalade = { verite: escaladeBank.verite.top, action: escaladeBank.action.top };
            for (const [id, contenu] of escaladeById) byId.set(id, contenu);
          }

          const { room, effects } = startGame(entry.room, { questionPool });
          const effectsEnriched = enrichEffects(effects, room);

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

    // ---------- Règle A : le refus qui coûte ----------

    socket.on('turn:pass', async (_, ack) => {
      try {
        const entry = requireEntry(socket);
        await runExclusive(entry, async () => {
          const { room, effects } = submitPass(entry.room, { playerId: socket.data.playerId });
          await applyGameEffects(io, entry, room, effects);
        });
        ack?.({ ok: true });
      } catch (err) {
        ack?.(errorResponse(err));
      }
    });

    socket.on('turn:questionChoice', async (payload, ack) => {
      try {
        const entry = requireEntry(socket);
        const { questionId } = payload ?? {};
        await runExclusive(entry, async () => {
          const { room, effects } = chooseQuestion(entry.room, { playerId: socket.data.playerId, questionId });
          await applyGameEffects(io, entry, room, effects);
        });
        ack?.({ ok: true });
      } catch (err) {
        ack?.(errorResponse(err));
      }
    });

    // ---------- Règle B : le double ou rien ----------

    socket.on('turn:niveauChoice', async (payload, ack) => {
      try {
        const entry = requireEntry(socket);
        const { accept } = payload ?? {};
        await runExclusive(entry, async () => {
          const { room, effects } = respondDoubleOuRien(entry.room, { playerId: socket.data.playerId, accept });
          await applyGameEffects(io, entry, room, effects);
        });
        ack?.({ ok: true });
      } catch (err) {
        ack?.(errorResponse(err));
      }
    });

    // ---------- Règle C : la question retournée ----------

    socket.on('turn:returnQuestion', async (_, ack) => {
      try {
        const entry = requireEntry(socket);
        await runExclusive(entry, async () => {
          const { room, effects } = returnQuestion(entry.room, { playerId: socket.data.playerId });
          await applyGameEffects(io, entry, room, effects);
        });
        ack?.({ ok: true });
      } catch (err) {
        ack?.(errorResponse(err));
      }
    });

    // ---------- Règle E : le pari mutuel ----------

    socket.on('turn:bet', async (payload, ack) => {
      try {
        const entry = requireEntry(socket);
        const { text } = payload ?? {};
        await runExclusive(entry, async () => {
          const { room, effects } = submitBet(entry.room, { playerId: socket.data.playerId, text });
          // Volontairement pas de diffusion : le pari reste caché du joueur
          // actif tant qu'il n'a pas répondu (voir game/turn.js).
          await applyGameEffects(io, entry, room, effects);
        });
        ack?.({ ok: true });
      } catch (err) {
        ack?.(errorResponse(err));
      }
    });

    socket.on('turn:judgeBet', async (payload, ack) => {
      try {
        const entry = requireEntry(socket);
        const { verdict } = payload ?? {};
        await runExclusive(entry, async () => {
          const { room, effects } = judgeBet(entry.room, { playerId: socket.data.playerId, verdict });
          await applyGameEffects(io, entry, room, effects);
        });
        ack?.({ ok: true });
      } catch (err) {
        ack?.(errorResponse(err));
      }
    });

    // ---------- Règle D : le tour surprise ----------

    socket.on('turn:surpriseAnswer', async (payload, ack) => {
      try {
        const entry = requireEntry(socket);
        const { text } = payload ?? {};
        await runExclusive(entry, async () => {
          const { room, effects } = submitSurpriseAnswer(entry.room, { playerId: socket.data.playerId, text });
          await applyGameEffects(io, entry, room, effects);
        });
        ack?.({ ok: true });
      } catch (err) {
        ack?.(errorResponse(err));
      }
    });

    socket.on('turn:surpriseVote', async (payload, ack) => {
      try {
        const entry = requireEntry(socket);
        const { targetId } = payload ?? {};
        await runExclusive(entry, async () => {
          const { room, effects } = submitSurpriseVote(entry.room, { voterId: socket.data.playerId, targetId });
          await applyGameEffects(io, entry, room, effects);
        });
        ack?.({ ok: true });
      } catch (err) {
        ack?.(errorResponse(err));
      }
    });

    socket.on('recap:fetch', async (_, ack) => {
      try {
        const entry = requireEntry(socket);
        if (!entry.dbPartieId) {
          ack?.({ ok: true, turns: [] });
          return;
        }

        // Toujours reconstruit depuis turns/questions/users, jamais depuis le
        // cache mémoire du chat : c'est la source de vérité pour l'historique.
        const rows = await repo.fetchTurnsRecap(pool, entry.dbPartieId);
        const turnIds = rows.map((r) => r.id);
        const votesRows = await repo.fetchVotesForTurns(pool, turnIds);
        const votesByTurn = new Map();
        for (const v of votesRows) {
          const agg = votesByTurn.get(v.turn_id) ?? { up: 0, down: 0 };
          if (v.valeur === 1) agg.up += 1;
          else agg.down += 1;
          votesByTurn.set(v.turn_id, agg);
        }

        // Un tour surprise a un détail par participant dans une table à part
        // (plusieurs répondants pour un seul tour) : présent uniquement pour
        // ces tours-là, ça sert justement à les distinguer d'un tour normal.
        const surpriseRows = await repo.fetchTourSurpriseReponsesForTurns(pool, turnIds);
        const surpriseByTurn = new Map();
        for (const s of surpriseRows) {
          const list = surpriseByTurn.get(s.turn_id) ?? [];
          list.push({ playerId: String(s.player_id), pseudo: s.pseudo, answer: s.reponse, votesRecus: s.votes_recus, points: s.points });
          surpriseByTurn.set(s.turn_id, list);
        }

        const turns = rows.map((r) => {
          const surpriseResults = surpriseByTurn.get(r.id);
          if (surpriseResults) {
            return {
              turnNumber: r.numero,
              mode: 'surprise',
              type: r.type,
              contenu: r.contenu,
              results: surpriseResults,
            };
          }
          return {
            turnNumber: r.numero,
            mode: 'normal',
            playerId: r.player_id != null ? String(r.player_id) : null,
            pseudo: r.pseudo,
            type: r.type,
            contenu: r.contenu,
            answer: r.reponse,
            points: r.points,
            timedOut: r.status === 'timeout',
            refused: r.reponse == null && r.status === 'done' && r.points < 0,
            votes: votesByTurn.get(r.id) ?? { up: 0, down: 0 },
          };
        });

        ack?.({ ok: true, turns });
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

        // Un message cité doit appartenir au même salon : jamais confiance
        // aveugle dans l'id fourni par le client.
        const rawReplyToId = payload?.replyToId;
        let replyTo = null;
        if (rawReplyToId != null) {
          replyTo = await repo.fetchMessageForReply(pool, entry.dbRoomId, Number(rawReplyToId));
          if (!replyTo) {
            throw new GameError('REPLY_TARGET_NOT_FOUND', 'Message cité introuvable');
          }
        }

        const saved = await repo.insertMessage(pool, entry.dbRoomId, Number(socket.data.playerId), trimmed, {
          replyToId: replyTo?.id ?? null,
        });

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
          replyTo,
          turnInfo: null,
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
