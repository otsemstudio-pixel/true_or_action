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
      if (effect.mode === 'surprise') {
        // Aucun répondant unique tant que le tour n'est pas résolu.
        const id = await repo.insertTurn(client, {
          roomId: entry.dbRoomId,
          partieId: entry.dbPartieId,
          playerId: null,
          questionId: effect.questionId,
          numero: effect.turnNumber,
          deadline: new Date(effect.answerDeadline),
        });
        return { newTurnDbId: id };
      }
      const id = await repo.insertTurn(client, {
        roomId: entry.dbRoomId,
        partieId: entry.dbPartieId,
        playerId: Number(effect.activePlayerId),
        questionId: effect.questionId,
        numero: effect.turnNumber,
        deadline: new Date(effect.answerDeadline),
        doubleOuRien: Boolean(effect.doubleOuRien),
        // Règle G, variante "bluff surprise" : décidé dès la création du
        // tour (voir game/turn.js), pas via une mise à jour ultérieure comme
        // pour une déclaration manuelle — les deux colonnes existent déjà
        // (bluff_declare sert aussi à la déclaration manuelle classique).
        bluffDeclare: Boolean(effect.bluffDeclared),
        bluffSurprise: Boolean(effect.bluffSurprise),
      });
      return { newTurnDbId: id };
    }
    case 'ANSWER_SUBMITTED': {
      await repo.updateTurnAnswered(client, entry.currentTurnDbId, {
        reponse: effect.answer,
        voteDeadline: new Date(effect.voteDeadline),
      });

      // La réponse est aussi publiée comme un message ordinaire (turn_id la
      // marque comme bloc de réponse plutôt que texte libre) : elle obtient
      // ainsi un vrai id, citable comme n'importe quel message du chat.
      const pseudo = entry.room.players.find((p) => p.id === effect.playerId)?.pseudo ?? '';
      const saved = await repo.insertMessage(client, entry.dbRoomId, Number(effect.playerId), effect.answer, {
        turnId: entry.currentTurnDbId,
      });
      const message = {
        id: saved.id,
        playerId: effect.playerId,
        pseudo,
        text: effect.answer,
        createdAt: new Date(saved.created_at).getTime(),
        replyTo: null,
        turnInfo: {
          turnNumber: effect.turnNumber,
          type: entry.room.currentTurn?.type ?? null,
          contenu: entry.questionsById.get(entry.room.currentTurn?.questionId) ?? null,
          points: null,
          resolved: false,
          thumbsUp: 0,
        },
      };
      return { newAnswerMessage: message };
    }
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

      // Règle E : le bonus du parieur va à un joueur différent de l'actif.
      if (effect.pariMutuel?.points > 0) {
        const bettorScore = newRoom.players.find((p) => p.id === effect.pariMutuel.bettorId)?.score ?? null;
        if (bettorScore != null) {
          await repo.updatePlayerScore(client, entry.dbRoomId, Number(effect.pariMutuel.bettorId), bettorScore);
        }
      }

      // Règle G : première mécanique à verser des points à des joueurs autres
      // que l'actif ou un bettor unique — chaque votant/miseur affecté doit
      // voir son propre score persisté, pas seulement celui du joueur actif.
      if (effect.bluffAssume) {
        const affectedIds = new Set([
          ...effect.bluffAssume.voterResults.map((r) => r.voterId),
          ...effect.bluffAssume.miseResults.map((r) => r.voterId),
        ]);
        for (const voterId of affectedIds) {
          const voterScore = newRoom.players.find((p) => p.id === voterId)?.score ?? null;
          if (voterScore != null) {
            await repo.updatePlayerScore(client, entry.dbRoomId, Number(voterId), voterScore);
          }
        }
      }
      return null;
    }
    // Règle A : un refus se résout comme un tour normal (aucune réponse,
    // points négatifs ou nuls), distinguable d'un timeout par reponse=null
    // ET points<0 — pas de nouvelle valeur d'enum turn_status pour ça.
    case 'PASS_SUBMITTED': {
      await repo.updateTurnResolved(client, entry.currentTurnDbId, { status: 'done', points: effect.points });
      const finalScore = newRoom.players.find((p) => p.id === effect.playerId)?.score ?? effect.points;
      await repo.updatePlayerScore(client, entry.dbRoomId, Number(effect.playerId), finalScore);
      return null;
    }
    // Règle C : la question change de répondant — le nouveau "titulaire" du
    // tour devient player_id ; l'original reste tracé pour l'historique et
    // pour interdire un retour en chaîne de la même question.
    case 'QUESTION_RETURNED': {
      await repo.updateTurnReturned(client, entry.currentTurnDbId, {
        newPlayerId: Number(effect.toPlayerId),
        returnedFromPlayerId: Number(effect.fromPlayerId),
      });
      await repo.insertRegleUsage(client, {
        partieId: entry.dbPartieId,
        playerId: Number(effect.fromPlayerId),
        regle: 'questionRetournee',
        turnId: entry.currentTurnDbId,
      });
      return null;
    }
    // Règle F : la contrainte tirée elle-même n'est jamais persistée (donnée
    // éphémère, voir reconstruct.js) — seul l'usage du joker par ce joueur
    // doit survivre, pour ne jamais pouvoir être réutilisé cette partie.
    case 'JOKER_ACTIVATED': {
      await repo.insertRegleUsage(client, {
        partieId: entry.dbPartieId,
        playerId: Number(effect.activatedBy),
        regle: 'jokerPublic',
        turnId: entry.currentTurnDbId,
      });
      // Variante "joker inversé" : contrairement à la contrainte de style,
      // le changement de question est un vrai changement d'état du tour —
      // doit survivre à une reconnexion en cours de tour (voir repository.js).
      if (effect.mode === 'questionPrecedente') {
        await repo.updateTurnQuestion(client, entry.currentTurnDbId, {
          questionId: effect.questionId,
          jokerInverse: true,
        });
      }
      return null;
    }
    // Règle G : ni l'une ni l'autre de ces deux écritures ne déclenche de
    // diffusion (voir broadcastEffects, aucun cas pour ces types) — la
    // persistance seule garantit qu'une reconnexion en cours de tour ne fait
    // disparaître ni la déclaration ni une mise déjà posée.
    case 'BLUFF_DECLARED':
      await repo.updateTurnBluffDeclare(client, entry.currentTurnDbId);
      return null;
    case 'BLUFF_MISE_SUBMITTED':
      await repo.insertBluffMise(client, {
        turnId: entry.currentTurnDbId,
        voterId: Number(effect.voterId),
        montant: effect.montant,
        prediction: effect.prediction,
      });
      return null;
    // Règle D : rien à écrire pendant le tour (réponses/votes cachés jusqu'à
    // la résolution) — tout se persiste d'un coup ici.
    case 'SURPRISE_RESOLVED': {
      const winner = effect.results.find((r) => effect.winnerIds.includes(r.playerId));
      await repo.updateTurnSurpriseResolved(client, entry.currentTurnDbId, {
        playerId: winner ? Number(winner.playerId) : null,
        reponse: winner?.answer ?? null,
        points: winner?.points ?? 0,
        status: 'done',
      });
      await repo.insertTourSurpriseReponses(client, entry.currentTurnDbId, effect.results);
      for (const result of effect.results) {
        const finalScore = newRoom.players.find((p) => p.id === result.playerId)?.score ?? result.points;
        await repo.updatePlayerScore(client, entry.dbRoomId, Number(result.playerId), finalScore);
      }
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
  let newAnswerMessage = null;
  for (const effect of effects) {
    const result = await persistEffect(client, entry, newRoom, effect);
    if (result?.newTurnDbId) newTurnDbId = result.newTurnDbId;
    if (result?.newAnswerMessage) newAnswerMessage = result.newAnswerMessage;
  }
  return { newTurnDbId, newAnswerMessage };
}
