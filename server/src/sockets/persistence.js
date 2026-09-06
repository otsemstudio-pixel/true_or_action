import * as repo from '../db/repository.js';

// Traduit un effet de src/game/turn.js en écriture(s) base de données.
// `client` est toujours explicite : soit `pool`, soit un client de transaction
// fourni par l'appelant (voir withTransaction dans db/pool.js).
// `newRoom` est l'état déjà calculé par la fonction pure (pas encore affecté à
// entry.room par l'appelant tant que la persistance n'a pas réussi) : on s'en
// sert pour lire les valeurs déjà à jour (score final...) sans dépendre de
// l'ordre d'affectation côté appelant.
export async function persistEffect(client, entry, newRoom, effect) {
  switch (effect.type) {
    case 'TURN_STARTED': {
      const id = await repo.insertTurn(client, {
        roomId: entry.dbRoomId,
        partieId: entry.dbPartieId,
        playerId: Number(effect.activePlayerId),
        questionId: effect.questionId,
        numero: effect.turnNumber,
        deadline: new Date(effect.answerDeadline),
      });
      return { newTurnDbId: id };
    }
    case 'ANSWER_SUBMITTED':
      await repo.updateTurnAnswered(client, entry.currentTurnDbId, {
        reponse: effect.answer,
        voteDeadline: new Date(effect.voteDeadline),
      });
      return null;
    case 'VOTE_SUBMITTED':
      await repo.insertVote(client, entry.currentTurnDbId, Number(effect.voterId), effect.vote);
      return null;
    case 'TURN_RESOLVED': {
      await repo.updateTurnResolved(client, entry.currentTurnDbId, {
        status: effect.timedOut ? 'timeout' : 'done',
        points: effect.points,
      });
      const finalScore = newRoom.players.find((p) => p.id === effect.playerId)?.score ?? effect.points;
      await repo.updatePlayerScore(client, entry.dbRoomId, Number(effect.playerId), finalScore);
      return null;
    }
    case 'GAME_ENDED':
      await repo.updateRoomStatus(client, entry.dbRoomId, 'finished');
      await repo.updatePartieEnded(client, entry.dbPartieId);
      return null;
    default:
      return null;
  }
}

export async function persistEffects(client, entry, newRoom, effects) {
  let newTurnDbId = null;
  for (const effect of effects) {
    const result = await persistEffect(client, entry, newRoom, effect);
    if (result?.newTurnDbId) newTurnDbId = result.newTurnDbId;
  }
  return { newTurnDbId };
}
