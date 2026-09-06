export function buildSnapshot(entry) {
  const { room, chat, timers } = entry;

  let currentTurn = null;
  if (room.currentTurn) {
    if (room.currentTurn.mode === 'surprise') {
      currentTurn = {
        mode: 'surprise',
        turnNumber: room.currentTurn.turnNumber,
        activePlayerIds: room.currentTurn.activePlayerIds,
        type: room.currentTurn.type,
        questionId: room.currentTurn.questionId,
        contenu: entry.questionsById.get(room.currentTurn.questionId) ?? null,
        phase: room.currentTurn.phase,
        answeredPlayerIds: Object.keys(room.currentTurn.answers),
        votes: room.currentTurn.votes,
        answerDeadline: timers.get('answer')?.deadline ?? null,
        voteDeadline: timers.get('vote')?.deadline ?? null,
      };
    } else {
      currentTurn = {
        mode: 'normal',
        turnNumber: room.currentTurn.turnNumber,
        activePlayerId: room.currentTurn.activePlayerId,
        type: room.currentTurn.type,
        questionId: room.currentTurn.questionId,
        contenu: room.currentTurn.questionId != null ? entry.questionsById.get(room.currentTurn.questionId) ?? null : null,
        phase: room.currentTurn.phase,
        answer: room.currentTurn.answer,
        votes: room.currentTurn.votes,
        doubleOuRien: room.currentTurn.doubleOuRien,
        returned: room.currentTurn.returned,
        originalPlayerId: room.currentTurn.originalPlayerId,
        pariMutuel: room.currentTurn.pariMutuel,
        choices:
          room.currentTurn.choices?.map((c) => ({
            questionId: c.questionId,
            type: c.type,
            contenu: entry.questionsById.get(c.questionId) ?? null,
          })) ?? null,
        answerDeadline: timers.get('answer')?.deadline ?? null,
        voteDeadline: timers.get('vote')?.deadline ?? null,
        niveauChoiceDeadline: timers.get('niveau_choice')?.deadline ?? null,
        questionChoiceDeadline: timers.get('question_choice')?.deadline ?? null,
        jugementDeadline: timers.get('jugement')?.deadline ?? null,
      };
    }
  }

  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    settings: room.settings,
    niveauMax: room.niveauMax,
    langue: room.langue,
    regles: room.regles,
    partieId: entry.dbPartieId ?? null,
    players: room.players,
    turnNumber: room.turnNumber,
    currentTurn,
    messages: chat.messages.slice(-30),
  };
}
