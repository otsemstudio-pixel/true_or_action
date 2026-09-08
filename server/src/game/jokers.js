// Effets des jokers, catégories Régularité et Bluff et jugement (10 des 50
// à venir, voir le prompt d'architecture). Fonctions pures, appelées depuis
// turn.js au moment de résoudre un tour — aucune ne connaît la structure
// d'un salon au-delà de `history` et `players`, pour rester testable sans
// dépendre du reste du moteur de jeu.
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
  // Catégorie Bluff et jugement (règle G, "le bluff assumé") : voir le
  // préalable du prompt — bluffDeclared est un booléen auto-déclaré par le
  // joueur actif, jamais vérifié contre une vérité de fond. "Deviner juste"
  // ne signifie donc jamais rien de plus que "concorder avec bluffDeclared".
  LE_PARIEUR: 'leParieur',
  LE_SEMEUR_DE_DOUTE: 'leSemeurDeDoute',
  LE_MASQUE: 'leMasque',
  LE_LIMIER: 'leLimier',
  LE_SCEPTIQUE_PERPETUEL: 'leSceptiquePerpetuel',
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

// ---------- Le masque ----------
// Pas de marqueur dédié (contrairement à `increvableUsed`) : `bluffAssume`
// n'est PAS reconstruit en détail après une reconnexion (voir
// turnReconstruction.js — seul `.declared` survit, par choix assumé, les
// détails de révélation ne servent qu'à l'affichage temps réel). Un
// marqueur `masqueUsed` serait donc perdu à la moindre reconnexion et
// laisserait Le masque se redéclencher. À la place, on redérive
// "majorité dupée" depuis `votes` (lui bien reconstruit) : comme un joueur
// garde le même joker toute la partie, "j'ai déjà eu un tour où la majorité
// a été dupée" équivaut exactement à "Le masque s'est déjà déclenché" —
// tout tour majoritairement dupé AVANT le premier était par définition
// impossible tant que Le masque n'avait pas encore tranché une fois.
export function hasUsedMasque(history, playerId) {
  return history.some((entry) => {
    if (entry.playerId !== playerId || entry.mode !== 'normal' || entry.answer == null) return false;
    if (!entry.bluffAssume?.declared) return false;
    const votes = Object.values(entry.votes ?? {});
    const fooledCount = votes.filter((v) => v === 'up').length;
    return votes.length > 0 && fooledCount > votes.length / 2;
  });
}

// ---------- Le limier ----------
// Même contrainte de reconstruction que Le masque ci-dessus : `voterResults`
// n'existe qu'en mémoire, jamais reconstruit. On relit donc directement
// `entry.votes[playerId]` (lui fiable après reconnexion) et on le
// réinterprète nous-mêmes exactement comme le fait resolveTurn en direct
// ("down" = a deviné juste, puisque bluffActive est vrai ici par construction).
//
// Suit les OPPORTUNITÉS de vote d'authenticité (tout tour où bluffActive est
// vrai — le seul contexte où un vote peut être jugé, voir le préalable),
// qu'il ait réellement voté ou non sur chacune. Son PROPRE tour n'en est
// jamais une (personne ne vote sur son propre bluff, voir submitVote) : il
// est totalement ignoré, ni pour la série ni pour la consommation d'un bonus
// déjà acquis — sinon un porteur qui ment sur son propre tour perdrait son
// bonus en attente sans jamais avoir eu l'occasion de voter dessus. Un tour
// d'un AUTRE joueur où il n'a pas voté, en revanche, est neutre pour la
// série (ni pour ni contre, même logique que le refus pour Le fidèle) — mais
// consomme quand même un bonus déjà acquis, puisque le prompt demande
// explicitement que le 4e vote soit crédité automatiquement SANS qu'il ait
// besoin de voter ce tour-là.
export function limierBonusDueForNextOpportunity(history, playerId) {
  let streak = 0;
  let pending = false;
  for (const entry of history) {
    if (entry.mode !== 'normal' || entry.playerId === playerId || !entry.bluffAssume?.declared) continue;
    pending = false;
    const vote = entry.votes?.[playerId];
    if (vote == null) continue;
    const guessedRight = vote === 'down';
    if (guessedRight) {
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

// ---------- Le sceptique perpétuel ----------
// Contrairement aux neuf autres jokers, celui-ci ne se règle jamais tour par
// tour : c'est un invariant sur LA PARTIE ENTIÈRE, vérifié une seule fois à
// la fin (voir turn.js, aux 4 points d'émission de GAME_ENDED). Pas de palier
// ni de remise à zéro comme Le limier — un seul "up" jamais rattrapable
// disqualifie le joueur pour le reste de la partie, donc pour la partie
// entière une fois relu depuis le début. Retourne `null` si disqualifié
// (au moins un "up" rencontré), sinon le nombre de votes "down" éligibles
// (le seuil minimum de 3 et la conversion en points restent à la charge de
// l'appelant, voir REGLES.sceptiquePerpetuelVotesMinimum/PointsParVote).
//
// Mêmes tours neutres que Le limier et pour la même raison : son propre tour
// de bluff (jamais votable par lui-même) et tout tour où il n'a pas voté du
// tout (déconnecté, minuteur expiré) — ni progression ni rupture dans les
// deux cas, seul un "up" effectivement posé rompt la série.
export function sceptiquePerpetuelVoteCount(history, playerId) {
  let count = 0;
  for (const entry of history) {
    if (entry.mode !== 'normal' || entry.playerId === playerId || !entry.bluffAssume?.declared) continue;
    const vote = entry.votes?.[playerId];
    if (vote == null) continue;
    if (vote === 'up') return null;
    count += 1;
  }
  return count;
}
