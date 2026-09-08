// Couche d'accès base de données : chaque fonction prend explicitement le
// client à utiliser (pool pour un appel isolé, client de transaction pour
// une séquence qui doit rester atomique) — jamais de client implicite.

// --- rooms ---

export async function insertRoom(db, { code, hostId, maxTurns, targetScore, timeoutSec, voteSec, langue, maxPlayers }) {
  const res = await db.query(
    `INSERT INTO rooms (code, host_id, status, max_turns, score_cible, timeout_sec, vote_sec, langue, max_players)
     VALUES ($1, $2, 'waiting', $3, $4, $5, $6, $7, $8) RETURNING id`,
    [code, hostId, maxTurns, targetScore, timeoutSec, voteSec, langue, maxPlayers]
  );
  const roomId = res.rows[0].id;
  // Les règles démarrent toutes désactivées (valeur par défaut des colonnes) ;
  // l'hôte les active ensuite depuis le salon d'attente.
  return roomId;
}

// Règles optionnelles (point 3) : toujours les cinq colonnes à la fois — le
// pur (game/room.js) a déjà fait la fusion partielle et la validation, cette
// couche ne fait qu'écrire l'objet complet qui en résulte.
export async function updateRoomRegles(db, roomId, regles) {
  await db.query(
    `UPDATE rooms SET
       regle_refus_couteux = $1,
       regle_double_ou_rien = $2,
       regle_question_retournee = $3,
       regle_tour_surprise = $4,
       regle_pari_mutuel = $5,
       regle_joker_public = $6,
       regle_joker_inverse = $7,
       regle_bluff_assume = $8,
       regle_bluff_surprise = $9
     WHERE id = $10`,
    [
      regles.refusCouteux,
      regles.doubleOuRien,
      regles.questionRetournee,
      regles.tourSurprise,
      regles.pariMutuel,
      regles.jokerPublic,
      regles.jokerInverse,
      regles.bluffAssume,
      regles.bluffSurprise,
      roomId,
    ]
  );
}

export function reglesFromRoomRow(row) {
  return {
    refusCouteux: row.regle_refus_couteux ?? false,
    doubleOuRien: row.regle_double_ou_rien ?? false,
    questionRetournee: row.regle_question_retournee ?? false,
    tourSurprise: row.regle_tour_surprise ?? false,
    pariMutuel: row.regle_pari_mutuel ?? false,
    jokerPublic: row.regle_joker_public ?? false,
    jokerInverse: row.regle_joker_inverse ?? false,
    bluffAssume: row.regle_bluff_assume ?? false,
    bluffSurprise: row.regle_bluff_surprise ?? false,
  };
}

export async function updateRoomSettings(db, roomId, { maxTurns, targetScore }) {
  await db.query('UPDATE rooms SET max_turns = $1, score_cible = $2 WHERE id = $3', [
    maxTurns,
    targetScore,
    roomId,
  ]);
}

export async function updateRoomHost(db, roomId, hostId) {
  await db.query('UPDATE rooms SET host_id = $1 WHERE id = $2', [hostId, roomId]);
}

export async function updateRoomNiveauMax(db, roomId, niveauMax) {
  await db.query('UPDATE rooms SET niveau_max = $1 WHERE id = $2', [niveauMax, roomId]);
}

export async function updateRoomTimeoutSec(db, roomId, timeoutSec) {
  await db.query('UPDATE rooms SET timeout_sec = $1 WHERE id = $2', [timeoutSec, roomId]);
}

export async function updateRoomMaxPlayers(db, roomId, maxPlayers) {
  await db.query('UPDATE rooms SET max_players = $1 WHERE id = $2', [maxPlayers, roomId]);
}

// Basculer de catégorie ajuste toujours la limite de joueurs et le niveau en
// même temps côté pur (game/room.js updateCategorie) : les trois colonnes
// sont donc écrites ensemble ici pour rester cohérentes en base.
export async function updateRoomCategorie(db, roomId, { categorie, maxPlayers, niveauMax }) {
  await db.query('UPDATE rooms SET categorie = $1, max_players = $2, niveau_max = $3 WHERE id = $4', [
    categorie,
    maxPlayers,
    niveauMax,
    roomId,
  ]);
}

export async function updateRoomLangue(db, roomId, langue) {
  await db.query('UPDATE rooms SET langue = $1 WHERE id = $2', [langue, roomId]);
}

export async function updateRoomStatus(db, roomId, status) {
  if (status === 'finished') {
    await db.query("UPDATE rooms SET status = $1, finished_at = now() WHERE id = $2", [status, roomId]);
  } else {
    await db.query('UPDATE rooms SET status = $1 WHERE id = $2', [status, roomId]);
  }
}

export async function fetchPlayingRooms(db) {
  const res = await db.query("SELECT * FROM rooms WHERE status = 'playing'");
  return res.rows;
}

export async function fetchRoomByCode(db, code) {
  const res = await db.query('SELECT * FROM rooms WHERE code = $1', [code]);
  return res.rows[0] ?? null;
}

// --- room_players ---

export async function insertRoomPlayer(db, roomId, userId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await db.query(
        `INSERT INTO room_players (room_id, user_id, ordre, score, state)
         SELECT $1, $2, COALESCE(MAX(ordre), 0) + 1, 0, 'active' FROM room_players WHERE room_id = $1`,
        [roomId, userId]
      );
      return;
    } catch (err) {
      if (err.code === '23505' && attempt < 2) continue;
      throw err;
    }
  }
}

export async function deleteRoomPlayer(db, roomId, userId) {
  await db.query('DELETE FROM room_players WHERE room_id = $1 AND user_id = $2', [roomId, userId]);
}

export async function updatePlayerState(db, roomId, userId, state) {
  await db.query('UPDATE room_players SET state = $1, last_seen_at = now() WHERE room_id = $2 AND user_id = $3', [
    state,
    roomId,
    userId,
  ]);
}

export async function updatePlayerScore(db, roomId, userId, score) {
  await db.query('UPDATE room_players SET score = $1 WHERE room_id = $2 AND user_id = $3', [
    score,
    roomId,
    userId,
  ]);
}

export async function updatePlayerCarteJoker(db, roomId, userId, carteJoker) {
  await db.query('UPDATE room_players SET carte_joker = $1 WHERE room_id = $2 AND user_id = $3', [
    carteJoker,
    roomId,
    userId,
  ]);
}

// Une revanche remet aussi la carte joker à zéro (voir room.js restartRoom,
// même geste côté mémoire) : un joueur re-choisit à chaque nouvelle partie,
// jamais reconduit automatiquement.
export async function resetRoomPlayersScores(db, roomId) {
  await db.query('UPDATE room_players SET score = 0, carte_joker = NULL WHERE room_id = $1', [roomId]);
}

export async function deleteLeftPlayers(db, roomId) {
  await db.query("DELETE FROM room_players WHERE room_id = $1 AND state = 'left'", [roomId]);
}

// --- parties ---
// Un salon (rooms) peut enchaîner plusieurs parties (« rejouer »). Chaque
// partie a son propre historique de tours/questions — l'unicité (une
// question ne ressort pas deux fois, un numéro de tour est unique) est
// scopée à la partie, jamais au salon.

export async function insertPartie(db, roomId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await db.query(
        `INSERT INTO parties (room_id, numero)
         SELECT $1, COALESCE(MAX(numero), 0) + 1 FROM parties WHERE room_id = $1
         RETURNING id`,
        [roomId]
      );
      return res.rows[0].id;
    } catch (err) {
      if (err.code === '23505' && attempt < 2) continue;
      throw err;
    }
  }
}

export async function updatePartieEnded(db, partieId) {
  await db.query('UPDATE parties SET ended_at = now() WHERE id = $1', [partieId]);
}

export async function fetchCurrentPartie(db, roomId) {
  const res = await db.query(
    'SELECT * FROM parties WHERE room_id = $1 AND ended_at IS NULL ORDER BY numero DESC LIMIT 1',
    [roomId]
  );
  return res.rows[0] ?? null;
}

export async function fetchRoomPlayers(db, roomId) {
  const res = await db.query(
    `SELECT rp.user_id, rp.ordre, rp.score, rp.state, rp.last_seen_at, rp.carte_joker, u.pseudo, u.is_guest
     FROM room_players rp JOIN users u ON u.id = rp.user_id
     WHERE rp.room_id = $1 ORDER BY rp.ordre ASC`,
    [roomId]
  );
  return res.rows;
}

// --- turns ---

export async function insertTurn(
  db,
  { roomId, partieId, playerId, questionId, numero, deadline, doubleOuRien = false, bluffDeclare = false, bluffSurprise = false }
) {
  const res = await db.query(
    `INSERT INTO turns (room_id, partie_id, player_id, question_id, numero, status, deadline, double_ou_rien, bluff_declare, bluff_surprise)
     VALUES ($1, $2, $3, $4, $5, 'answering', $6, $7, $8, $9) RETURNING id`,
    [roomId, partieId, playerId, questionId, numero, deadline, doubleOuRien, bluffDeclare, bluffSurprise]
  );
  return res.rows[0].id;
}

// Règle C : la question a changé de mains — le nouveau répondant (celui qui
// marquera les points) devient player_id, l'original est tracé à part.
export async function updateTurnReturned(db, turnId, { newPlayerId, returnedFromPlayerId }) {
  await db.query('UPDATE turns SET player_id = $1, returned_from_player_id = $2 WHERE id = $3', [
    newPlayerId,
    returnedFromPlayerId,
    turnId,
  ]);
}

// Règle F, variante "joker inversé" : la question de ce tour est remplacée
// par celle du tour précédent — contrairement à la contrainte de style
// (jamais persistée), un vrai changement de question doit survivre à une
// reconnexion en cours de tour, donc une écriture explicite ici.
// question_id (celle tirée à l'origine pour ce tour, jamais montrée) est mis
// à NULL plutôt qu'écrasé : une contrainte UNIQUE(partie_id, question_id)
// empêche une question d'apparaître deux fois dans la même partie, et cette
// même question reste par ailleurs déjà référencée par le tour précédent
// qu'on recycle. La question réellement posée vit dans une colonne dédiée
// (joker_inverse_question_id) — voir fetchUsedQuestionIds et fetchTurnsRecap
// pour les deux endroits qui doivent en tenir compte.
export async function updateTurnQuestion(db, turnId, { questionId, jokerInverse }) {
  await db.query('UPDATE turns SET question_id = NULL, joker_inverse_question_id = $1, joker_inverse = $2 WHERE id = $3', [
    questionId,
    jokerInverse,
    turnId,
  ]);
}

// Règle G : la déclaration elle-même doit survivre à une reconnexion en
// cours de tour, sans quoi resolveTurn retomberait sur le vote de qualité
// normal après un rechargement — perdant tout le mécanisme silencieusement,
// exactement le genre de bug que le correctif room:rejoin visait à éviter.
export async function updateTurnBluffDeclare(db, turnId) {
  await db.query('UPDATE turns SET bluff_declare = true WHERE id = $1', [turnId]);
}

export async function insertBluffMise(db, { turnId, voterId, montant, prediction }) {
  await db.query(
    `INSERT INTO bluff_mises (turn_id, voter_id, montant, prediction)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (turn_id, voter_id) DO NOTHING`,
    [turnId, voterId, montant, prediction]
  );
}

export async function fetchBluffMisesForTurn(db, turnId) {
  const res = await db.query('SELECT voter_id, montant, prediction FROM bluff_mises WHERE turn_id = $1', [turnId]);
  return res.rows;
}

export async function updateTurnAnswered(db, turnId, { reponse, voteDeadline }) {
  await db.query('UPDATE turns SET status = $1, reponse = $2, vote_deadline = $3 WHERE id = $4', [
    'voting',
    reponse,
    voteDeadline,
    turnId,
  ]);
}

export async function updateTurnResolved(db, turnId, { status, points }) {
  await db.query('UPDATE turns SET status = $1, points = $2 WHERE id = $3', [status, points, turnId]);
}

// Tour surprise (règle D) : au moment du tirage, aucun joueur unique n'est
// encore "le" répondant — player_id/reponse ne sont connus qu'à la
// résolution (le gagnant, ou null en cas d'égalité à zéro vote). Le détail
// par participant vit dans tour_surprise_reponses, pas dans turns.
export async function updateTurnSurpriseResolved(db, turnId, { playerId, reponse, points, status }) {
  await db.query('UPDATE turns SET status = $1, points = $2, player_id = $3, reponse = $4 WHERE id = $5', [
    status,
    points,
    playerId,
    reponse,
    turnId,
  ]);
}

export async function insertTourSurpriseReponses(db, turnId, results) {
  for (const r of results) {
    await db.query(
      `INSERT INTO tour_surprise_reponses (turn_id, player_id, reponse, votes_recus, points)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (turn_id, player_id) DO NOTHING`,
      [turnId, Number(r.playerId), r.answer, r.votesRecus, r.points]
    );
  }
}

export async function fetchTourSurpriseReponses(db, turnId) {
  const res = await db.query(
    `SELECT tsr.player_id, u.pseudo, tsr.reponse, tsr.votes_recus, tsr.points
     FROM tour_surprise_reponses tsr JOIN users u ON u.id = tsr.player_id
     WHERE tsr.turn_id = $1 ORDER BY tsr.points DESC, tsr.votes_recus DESC`,
    [turnId]
  );
  return res.rows;
}

export async function fetchTourSurpriseReponsesForTurns(db, turnIds) {
  if (turnIds.length === 0) return [];
  const res = await db.query(
    `SELECT tsr.turn_id, tsr.player_id, u.pseudo, tsr.reponse, tsr.votes_recus, tsr.points
     FROM tour_surprise_reponses tsr JOIN users u ON u.id = tsr.player_id
     WHERE tsr.turn_id = ANY($1) ORDER BY tsr.turn_id, tsr.points DESC, tsr.votes_recus DESC`,
    [turnIds]
  );
  return res.rows;
}

// Règles à usage limité (point 3) : "ce joueur a déjà utilisé cette règle
// dans cette partie". Générique, réutilisable au-delà de la question
// retournée si d'autres règles à usage unique apparaissent plus tard.
export async function insertRegleUsage(db, { partieId, playerId, regle, turnId = null }) {
  await db.query(
    `INSERT INTO regle_usages (partie_id, player_id, regle, turn_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (partie_id, player_id, regle) DO NOTHING`,
    [partieId, playerId, regle, turnId]
  );
}

export async function fetchRegleUsage(db, partieId, regle) {
  const res = await db.query('SELECT player_id FROM regle_usages WHERE partie_id = $1 AND regle = $2', [
    partieId,
    regle,
  ]);
  return res.rows.map((r) => r.player_id);
}

export async function fetchLatestTurn(db, partieId) {
  const res = await db.query('SELECT * FROM turns WHERE partie_id = $1 ORDER BY numero DESC LIMIT 1', [partieId]);
  return res.rows[0] ?? null;
}

export async function fetchUsedQuestionIds(db, partieId) {
  // COALESCE : un tour "joker inversé" a son question_id mis à NULL (voir
  // updateTurnQuestion) — la question réellement posée pour ce tour vit dans
  // joker_inverse_question_id à la place, déjà comptée "utilisée" par le tour
  // d'origine qu'il recycle de toute façon.
  const res = await db.query(
    `SELECT COALESCE(joker_inverse_question_id, question_id) AS question_id
     FROM turns
     WHERE partie_id = $1 AND COALESCE(joker_inverse_question_id, question_id) IS NOT NULL`,
    [partieId]
  );
  return res.rows.map((r) => r.question_id);
}

// Récapitulatif : reconstruit exclusivement depuis turns/questions/users,
// jamais depuis l'historique du chat en mémoire — c'est la source de vérité
// même après un redémarrage serveur ou une reconnexion.
export async function fetchTurnsRecap(db, partieId) {
  const res = await db.query(
    `SELECT t.id, t.numero, t.player_id, u.pseudo, q.type, q.contenu, t.reponse, t.points, t.status
     FROM turns t
     LEFT JOIN users u ON u.id = t.player_id
     LEFT JOIN questions q ON q.id = COALESCE(t.joker_inverse_question_id, t.question_id)
     WHERE t.partie_id = $1 AND t.status IN ('done', 'timeout')
     ORDER BY t.numero ASC`,
    [partieId]
  );
  return res.rows;
}

export async function fetchVotesForTurns(db, turnIds) {
  if (turnIds.length === 0) return [];
  const res = await db.query('SELECT turn_id, valeur FROM votes WHERE turn_id = ANY($1)', [turnIds]);
  return res.rows;
}

// room.history (game/turn.js) : contrairement au récapitulatif ci-dessus
// (agrégats seulement, jamais qui a voté quoi), findBestPreviousVoter (règle
// C) et findPreviousNormalTurn (règle G) ont besoin de l'identité du votant —
// d'où une requête séparée plutôt que de réutiliser fetchVotesForTurns.
export async function fetchVotesForTurnsWithVoter(db, turnIds) {
  if (turnIds.length === 0) return [];
  const res = await db.query('SELECT turn_id, voter_id, valeur FROM votes WHERE turn_id = ANY($1)', [turnIds]);
  return res.rows;
}

// room.history : tous les tours déjà résolus de la partie, dans l'ordre —
// c'est ce que game/turn.js accumule au fil de la partie dans room.history,
// jamais reconstruit depuis la base jusqu'ici (voir sockets/reconstruct.js).
// Même filtre de statut que fetchTurnsRecap : un tour "en cours" (answering/
// voting/pré-phase) n'en fait jamais partie, il vit dans currentTurn.
export async function fetchTurnHistory(db, partieId) {
  const res = await db.query(
    `SELECT t.id, t.numero, t.player_id, COALESCE(t.joker_inverse_question_id, t.question_id) AS question_id,
            q.type, t.reponse, t.points, t.status, t.double_ou_rien, t.returned_from_player_id, t.joker_inverse,
            t.bluff_declare
     FROM turns t
     LEFT JOIN questions q ON q.id = COALESCE(t.joker_inverse_question_id, t.question_id)
     WHERE t.partie_id = $1 AND t.status IN ('done', 'timeout')
     ORDER BY t.numero ASC`,
    [partieId]
  );
  return res.rows;
}

// --- votes ---

export async function insertVote(db, turnId, voterId, vote) {
  const valeur = vote === 'up' ? 1 : -1;
  await db.query(
    `INSERT INTO votes (turn_id, voter_id, valeur) VALUES ($1, $2, $3)
     ON CONFLICT (turn_id, voter_id) DO NOTHING`,
    [turnId, voterId, valeur]
  );
}

export async function fetchVotesForTurn(db, turnId) {
  const res = await db.query('SELECT voter_id, valeur FROM votes WHERE turn_id = $1', [turnId]);
  return res.rows;
}

// --- messages ---

// `turnId` marque un message comme le bloc de réponse publié automatiquement
// pour ce tour (plutôt que du texte libre) : même table, même mécanisme de
// citation (reply_to_id) pour les deux, jamais de branche spéciale ailleurs.
export async function insertMessage(db, roomId, userId, contenu, { replyToId = null, turnId = null } = {}) {
  const res = await db.query(
    `INSERT INTO messages (room_id, user_id, contenu, reply_to_id, turn_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
    [roomId, userId, contenu, replyToId, turnId]
  );
  return res.rows[0];
}

// Un message cité ne peut l'être que s'il appartient au même salon (sécurité :
// on ne veut pas qu'un client cite un message d'un autre salon par son id).
export async function fetchMessageForReply(db, roomId, messageId) {
  const res = await db.query(
    `SELECT m.id, m.contenu AS text, u.pseudo
     FROM messages m JOIN users u ON u.id = m.user_id
     WHERE m.id = $1 AND m.room_id = $2`,
    [messageId, roomId]
  );
  return res.rows[0] ?? null;
}

export async function fetchRecentMessages(db, roomId, limit = 30) {
  const res = await db.query(
    `SELECT
       m.id, m.user_id, m.contenu, m.created_at, m.reply_to_id, m.turn_id,
       u.pseudo,
       t.numero AS turn_numero, t.points AS turn_points, t.status AS turn_status,
       q.type AS question_type, q.contenu AS question_contenu,
       rm.contenu AS reply_contenu, ru.pseudo AS reply_pseudo,
       COALESCE(v.thumbs_up, 0) AS thumbs_up
     FROM messages m
     JOIN users u ON u.id = m.user_id
     LEFT JOIN turns t ON t.id = m.turn_id
     LEFT JOIN questions q ON q.id = t.question_id
     LEFT JOIN messages rm ON rm.id = m.reply_to_id
     LEFT JOIN users ru ON ru.id = rm.user_id
     LEFT JOIN LATERAL (
       SELECT count(*) FILTER (WHERE valeur = 1) AS thumbs_up
       FROM votes WHERE votes.turn_id = m.turn_id
     ) v ON m.turn_id IS NOT NULL
     WHERE m.room_id = $1
     ORDER BY m.created_at DESC LIMIT $2`,
    [roomId, limit]
  );
  return res.rows.reverse();
}

// --- questions ---

// Bucket "top" = niveau exactement égal à niveauMax (le niveau choisi par
// l'hôte), "lower" = tous les niveaux strictement en dessous. C'est sur ce
// découpage que game/turn.js applique la pondération 60/40 du tirage.
//
// Catégorie 'couple' : les questions n'ont pas de notion de niveau (elles
// vont du léger à l'intime dans un même ensemble) — niveauMax est ignoré et
// tout tombe dans "top", ce qui revient à un tirage à plat sur l'ensemble de
// la catégorie sans toucher à la logique de pondération de game/turn.js.
export async function fetchQuestionBank(db, { niveauMax = 1, langue = 'fr', categorie = 'general' } = {}) {
  const isCouple = categorie === 'couple';
  const res = await db.query(
    isCouple
      ? 'SELECT id, type, contenu, niveau FROM questions WHERE is_public = true AND categorie = $1 AND langue = $2'
      : 'SELECT id, type, contenu, niveau FROM questions WHERE is_public = true AND categorie = $1 AND langue = $2 AND niveau <= $3',
    isCouple ? [categorie, langue] : [categorie, langue, niveauMax]
  );

  const questionPool = {
    verite: { top: [], lower: [] },
    action: { top: [], lower: [] },
  };
  const byId = new Map();

  for (const row of res.rows) {
    const bucket = isCouple || row.niveau === niveauMax ? 'top' : 'lower';
    questionPool[row.type][bucket].push(row.id);
    byId.set(row.id, row.contenu);
  }

  return { questionPool, byId };
}

export async function fetchQuestionById(db, questionId) {
  const res = await db.query('SELECT id, type, contenu FROM questions WHERE id = $1', [questionId]);
  return res.rows[0] ?? null;
}

// --- signalements ---

// Un joueur ne peut signaler une même question qu'une seule fois (contrainte
// unique question_id+user_id en base) : DO NOTHING plutôt qu'une erreur, une
// deuxième tentative n'apprend rien de plus à l'admin et ne doit jamais
// bloquer le joueur qui double-clique.
export async function insertSignalement(db, { questionId, userId, roomId }) {
  await db.query(
    `INSERT INTO signalements (question_id, user_id, room_id) VALUES ($1, $2, $3)
     ON CONFLICT (question_id, user_id) DO NOTHING`,
    [questionId, userId, roomId]
  );
}
