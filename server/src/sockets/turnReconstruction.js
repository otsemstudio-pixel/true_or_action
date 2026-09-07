// Transformations pures (aucun accès base, aucune dépendance à db/pool.js ou
// config/env.js) : à partir de lignes déjà récupérées par l'appelant,
// reconstruisent l'état de tour attendu par game/turn.js. Isolées dans leur
// propre fichier, sans dépendance sur reconstruct.js (qui importe le pool pg
// et échoue donc à l'import sans variables d'environnement), pour rester
// testables sans base de données réelle — c'est justement l'absence de test
// sur ces reconstructions qui a laissé passer le bug "history toujours vide"
// jusqu'en production.

// room.history : findBestPreviousVoter (règle C) et findPreviousNormalTurn
// (règle G) ne lisent tous les deux que le dernier élément.
export function buildHistoryFromRows(historyRows, votesRows, surpriseRows) {
  const votesByTurn = new Map();
  for (const v of votesRows) {
    const votes = votesByTurn.get(v.turn_id) ?? {};
    votes[String(v.voter_id)] = v.valeur === 1 ? 'up' : 'down';
    votesByTurn.set(v.turn_id, votes);
  }
  const surpriseByTurn = new Map();
  for (const s of surpriseRows) {
    const results = surpriseByTurn.get(s.turn_id) ?? [];
    results.push({ playerId: String(s.player_id), answer: s.reponse, votesRecus: s.votes_recus, points: s.points });
    surpriseByTurn.set(s.turn_id, results);
  }
  return historyRows.map((row) => {
    if (surpriseByTurn.has(row.id)) {
      return {
        turnNumber: row.numero,
        mode: 'surprise',
        questionId: row.question_id,
        type: row.type ?? null,
        results: surpriseByTurn.get(row.id),
        votes: {},
      };
    }
    return {
      turnNumber: row.numero,
      mode: 'normal',
      playerId: row.player_id != null ? String(row.player_id) : null,
      type: row.type ?? null,
      questionId: row.question_id,
      answer: row.reponse,
      votes: votesByTurn.get(row.id) ?? {},
      points: row.points ?? 0,
      doubleOuRien: Boolean(row.double_ou_rien),
      returned: row.returned_from_player_id != null,
      refused: row.status === 'done' && row.reponse == null,
      // Détail de révélation (pari mutuel, contrainte de joker, bluff) jamais
      // persisté sous forme structurée — seul son effet sur les scores l'est
      // (même compromis assumé que pour le tour en cours, voir plus bas).
      pariMutuel: null,
      jokerConstraint: null,
      jokerInverse: Boolean(row.joker_inverse),
      bluffAssume: null,
    };
  });
}

// currentTurn (tour "normal" en cours, answering/voting) : reconstruit à
// partir de la ligne turns la plus récente + ses sous-données déjà
// récupérées (votes, mises de bluff) + le type de question déjà résolu.
// bluffDeclared/bluffSurprise doivent survivre à une reconnexion (exigence
// explicite de la Phase 3/4) — contrairement à la contrainte de style du
// joker (Phase 1) ou au pari mutuel en cours, jamais persistés eux, et donc
// jamais reconstruits ici (voir game/turn.js pour l'arbitrage).
export function buildCurrentNormalTurnFromRow(latestTurn, { votesRows, bluffMisesRows, questionType }) {
  const votes = {};
  for (const v of votesRows) votes[String(v.voter_id)] = v.valeur === 1 ? 'up' : 'down';

  const bluffMises = {};
  for (const m of bluffMisesRows) {
    bluffMises[String(m.voter_id)] = { montant: m.montant, prediction: m.prediction };
  }

  // Un tour "joker inversé" a son question_id mis à NULL en base (voir
  // repository.js updateTurnQuestion) : la question réellement posée vit
  // dans joker_inverse_question_id à la place.
  const effectiveQuestionId = latestTurn.joker_inverse_question_id ?? latestTurn.question_id;

  return {
    mode: 'normal',
    turnNumber: latestTurn.numero,
    activePlayerId: String(latestTurn.player_id),
    type: questionType ?? null,
    questionId: effectiveQuestionId,
    phase: latestTurn.status,
    answer: latestTurn.reponse,
    votes,
    doubleOuRien: Boolean(latestTurn.double_ou_rien),
    returned: latestTurn.returned_from_player_id != null,
    originalPlayerId: latestTurn.returned_from_player_id != null ? String(latestTurn.returned_from_player_id) : null,
    pariMutuel: null,
    jokerConstraint: null,
    jokerInverse: Boolean(latestTurn.joker_inverse),
    jokerActivated: Boolean(latestTurn.joker_inverse),
    bluffDeclared: Boolean(latestTurn.bluff_declare),
    bluffSurprise: Boolean(latestTurn.bluff_surprise),
    bluffMises,
  };
}
