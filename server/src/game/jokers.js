// Effets des jokers, catégorie Régularité (5 des 50 à venir, voir le prompt
// d'architecture). Fonctions pures, appelées depuis turn.js au moment de
// résoudre un tour — aucune ne connaît la structure d'un salon au-delà de
// `history` et `players`, pour rester testable sans dépendre du reste du
// moteur de jeu.
//
// Choix délibéré : aucun compteur n'est stocké séparément dans l'état de la
// partie — chaque jauge se recalcule à la demande à partir de `room.history`
// (déjà fiable après une reconnexion, voir reconstruct.js/turnReconstruction.js
// corrigés précédemment). Une reconnexion ne peut donc jamais faire perdre la
// progression d'un joker, exactement comme pour room.history lui-même.
//
// Un tour surprise ne compte jamais pour Le fidèle ni Le métronome (ni pour
// ni contre, décision validée) : passer et bluffer n'existent pas dans ce
// mode, le confondre avec un tour normal fausserait les deux compteurs.

export const JOKER_IDS = {
  LE_FIDELE: 'leFidele',
  LE_METRONOME: 'leMetronome',
  LINCREVABLE: 'lIncrevable',
  LE_VETERAN: 'leVeteran',
  LE_RITUEL: 'leRituel',
};

// ---------- Le fidèle ----------
// Rejoue les tours normaux de ce joueur pour savoir si SON PROCHAIN tour
// (pas encore résolu, donc absent de `history`) doit toucher le bonus.
// `pending` est réévalué à chaque tour normal rencontré : un refus consomme
// un bonus déjà acquis comme n'importe quel autre tour joué (choix assumé,
// non couvert littéralement par le prompt — un refus reste neutre pour la
// progression du compteur lui-même, seulement pour la réception du bonus).
export function fideleBonusDueForNextTurn(history, playerId) {
  let streak = 0;
  let pending = false;
  for (const entry of history) {
    if (entry.playerId !== playerId || entry.mode !== 'normal') continue;
    pending = false;
    if (entry.refused) continue;
    const sincere = !entry.bluffAssume?.declared;
    if (sincere) {
      streak += 1;
      if (streak === 3) {
        streak = 0;
        pending = true;
      }
    } else {
      streak = 0;
    }
  }
  return pending;
}

// ---------- Le métronome ----------
// Renvoie la série en cours (tours normaux joués sans refus) juste avant le
// tour à résoudre — palier de 5 payé immédiatement, jamais différé au tour
// suivant contrairement à Le fidèle (le prompt ne mentionne aucun report ici).
export function metronomeStreakBefore(history, playerId) {
  let streak = 0;
  for (const entry of history) {
    if (entry.playerId !== playerId || entry.mode !== 'normal') continue;
    if (entry.refused) {
      streak = 0;
      continue;
    }
    streak += 1;
    if (streak === 5) streak = 0;
  }
  return streak;
}

// ---------- L'increvable ----------
// Marqueur explicite (`increvableUsed`) plutôt qu'une déduction depuis
// `points` : un refus après double ou rien a lui aussi points=0 (règle B),
// sans rapport avec ce joker — les confondre aurait offert un deuxième refus
// gratuit à la moindre coïncidence avec la règle B.
export function hasUsedIncrevable(history, playerId) {
  return history.some((entry) => entry.playerId === playerId && entry.increvableUsed === true);
}

// ---------- Le vétéran ----------
// Tous les porteurs encore en jeu touchent +1 tous les 5 tours de la partie
// ENTIÈRE (n'importe quel mode) — pas 5 tours du porteur lui-même.
export function applyVeteranBonus(players, newHistoryLength) {
  if (newHistoryLength % 5 !== 0) return players;
  return players.map((p) =>
    p.carteJoker === JOKER_IDS.LE_VETERAN && p.status === 'active' ? { ...p, score: p.score + 1 } : p
  );
}

// ---------- Le rituel ----------
// Uniquement les tours surprise (seul contexte où "premier à répondre" a un
// sens réel — un tour normal n'a qu'un seul répondant, toujours "premier"
// par construction, voir le rapport de phase). "Premier" = le premier nom
// dans answerOrder (ordre d'arrivée des réponses, voir startSurpriseTurn /
// submitSurpriseAnswer), jamais un horodatage — turn.js reste déterministe.
// Palier de 3 payé immédiatement puis remis à zéro, comme Le métronome ;
// montant (+1) choisi par cohérence avec Le fidèle, à confirmer.
export function rituelStreakBefore(history, playerId) {
  let streak = 0;
  for (const entry of history) {
    if (entry.mode !== 'surprise' || !entry.results?.some((r) => r.playerId === playerId)) continue;
    if (entry.firstResponderId === playerId) {
      streak += 1;
      if (streak === 3) streak = 0;
    } else {
      streak = 0;
    }
  }
  return streak;
}
