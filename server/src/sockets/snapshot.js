export function buildSnapshot(entry) {
  const { room, chat, timers } = entry;

  const currentTurn = room.currentTurn
    ? {
        turnNumber: room.currentTurn.turnNumber,
        activePlayerId: room.currentTurn.activePlayerId,
        type: room.currentTurn.type,
        questionId: room.currentTurn.questionId,
        contenu: entry.questionsById.get(room.currentTurn.questionId) ?? null,
        phase: room.currentTurn.phase,
        answer: room.currentTurn.answer,
        votes: room.currentTurn.votes,
        answerDeadline: timers.get('answer')?.deadline ?? null,
        voteDeadline: timers.get('vote')?.deadline ?? null,
      }
    : null;

  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    settings: room.settings,
    players: room.players,
    turnNumber: room.turnNumber,
    currentTurn,
    messages: chat.messages.slice(-30),
  };
}
