// Couche d'accès base de données : chaque fonction prend explicitement le
// client à utiliser (pool pour un appel isolé, client de transaction pour
// une séquence qui doit rester atomique) — jamais de client implicite.

// --- rooms ---

export async function insertRoom(db, { code, hostId, maxTurns, targetScore, timeoutSec, voteSec, langue }) {
  const res = await db.query(
    `INSERT INTO rooms (code, host_id, status, max_turns, score_cible, timeout_sec, vote_sec, langue)
     VALUES ($1, $2, 'waiting', $3, $4, $5, $6, $7) RETURNING id`,
    [code, hostId, maxTurns, targetScore, timeoutSec, voteSec, langue]
  );
  return res.rows[0].id;
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

export async function resetRoomPlayersScores(db, roomId) {
  await db.query('UPDATE room_players SET score = 0 WHERE room_id = $1', [roomId]);
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
    `SELECT rp.user_id, rp.ordre, rp.score, rp.state, rp.last_seen_at, u.pseudo
     FROM room_players rp JOIN users u ON u.id = rp.user_id
     WHERE rp.room_id = $1 ORDER BY rp.ordre ASC`,
    [roomId]
  );
  return res.rows;
}

// --- turns ---

export async function insertTurn(db, { roomId, partieId, playerId, questionId, numero, deadline }) {
  const res = await db.query(
    `INSERT INTO turns (room_id, partie_id, player_id, question_id, numero, status, deadline)
     VALUES ($1, $2, $3, $4, $5, 'answering', $6) RETURNING id`,
    [roomId, partieId, playerId, questionId, numero, deadline]
  );
  return res.rows[0].id;
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

export async function fetchLatestTurn(db, partieId) {
  const res = await db.query('SELECT * FROM turns WHERE partie_id = $1 ORDER BY numero DESC LIMIT 1', [partieId]);
  return res.rows[0] ?? null;
}

export async function fetchUsedQuestionIds(db, partieId) {
  const res = await db.query('SELECT question_id FROM turns WHERE partie_id = $1', [partieId]);
  return res.rows.map((r) => r.question_id);
}

// Récapitulatif : reconstruit exclusivement depuis turns/questions/users,
// jamais depuis l'historique du chat en mémoire — c'est la source de vérité
// même après un redémarrage serveur ou une reconnexion.
export async function fetchTurnsRecap(db, partieId) {
  const res = await db.query(
    `SELECT t.id, t.numero, t.player_id, u.pseudo, q.type, q.contenu, t.reponse, t.points, t.status
     FROM turns t
     JOIN users u ON u.id = t.player_id
     LEFT JOIN questions q ON q.id = t.question_id
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
export async function fetchQuestionBank(db, { niveauMax = 1, langue = 'fr' } = {}) {
  const res = await db.query(
    'SELECT id, type, contenu, niveau FROM questions WHERE is_public = true AND niveau <= $1 AND langue = $2',
    [niveauMax, langue]
  );

  const questionPool = {
    verite: { top: [], lower: [] },
    action: { top: [], lower: [] },
  };
  const byId = new Map();

  for (const row of res.rows) {
    const bucket = row.niveau === niveauMax ? 'top' : 'lower';
    questionPool[row.type][bucket].push(row.id);
    byId.set(row.id, row.contenu);
  }

  return { questionPool, byId };
}

export async function fetchQuestionById(db, questionId) {
  const res = await db.query('SELECT id, type, contenu FROM questions WHERE id = $1', [questionId]);
  return res.rows[0] ?? null;
}
