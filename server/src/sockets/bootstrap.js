import { pool } from '../db/pool.js';
import * as repo from '../db/repository.js';
import { TIMERS } from '../game/index.js';
import { loadRoomEntryFromDb } from './reconstruct.js';
import { setEntry, runExclusive } from './store.js';
import { setTimer, setGraceTimer } from './timers.js';
import { handleTimerFire, expireGrace } from './handlers.js';

// Recharge les parties en cours (status 'playing') depuis la base au démarrage
// du serveur et reconstruit leurs minuteurs à partir de turns.deadline /
// turns.vote_deadline. Une échéance déjà dépassée déclenche immédiatement la
// transition qui aurait dû avoir lieu pendant que le serveur était arrêté.
export async function reloadActiveRooms(io) {
  const rooms = await repo.fetchPlayingRooms(pool);

  for (const roomRow of rooms) {
    try {
      const { entry, deadlineInfo, disconnectedPlayers } = await loadRoomEntryFromDb(roomRow);
      setEntry(entry.room.code, entry);

      if (deadlineInfo && entry.room.currentTurn) {
        const timerName = deadlineInfo.phase === 'answering' ? 'answer' : 'vote';
        const turnNumber = entry.room.currentTurn.turnNumber;
        const remaining = new Date(deadlineInfo.deadline).getTime() - Date.now();

        if (remaining <= 0) {
          await runExclusive(entry, () => handleTimerFire(io, entry, timerName, turnNumber));
        } else {
          setTimer(entry, timerName, turnNumber, remaining, () =>
            runExclusive(entry, () => handleTimerFire(io, entry, timerName, turnNumber))
          );
        }
      }

      for (const player of disconnectedPlayers) {
        const remaining = TIMERS.disconnectGraceMs - (Date.now() - new Date(player.lastSeenAt).getTime());
        if (remaining <= 0) {
          await runExclusive(entry, () => expireGrace(io, entry, entry.room.code, player.id));
        } else {
          setGraceTimer(entry, player.id, remaining, () => {
            runExclusive(entry, () => expireGrace(io, entry, entry.room.code, player.id)).catch((err) => {
              console.error('Erreur expiration grâce (reprise):', err.code || err.name || 'erreur inconnue');
            });
          });
        }
      }

      console.log(`Salon ${entry.room.code} rechargé depuis la base (tour ${entry.room.turnNumber}).`);
    } catch (err) {
      console.error(`Échec du rechargement du salon ${roomRow.code}:`, err.code || err.name || 'erreur inconnue');
    }
  }

  if (rooms.length > 0) {
    console.log(`${rooms.length} partie(s) en cours rechargée(s) depuis la base.`);
  }
}
