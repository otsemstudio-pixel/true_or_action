// Tests d'intégration RÉELS (vrai serveur, vraie base) pour les 8 exigences
// empiriques de la Phase 5 du chantier modération/questions (voir les
// rapports de phases 1 à 4 pour le détail de chaque route) : chacune avait
// déjà été vérifiée ponctuellement pendant la construction via des scripts
// jetables, ce fichier les rejoue en permanence.
//
// Comme handlers.race.test.js (voir ce fichier pour le détail du choix
// d'architecture) : seul autre fichier de la suite à dépendre d'une vraie
// base et à faire tourner un vrai serveur — isolé ici plutôt que mélangé aux
// tests purs du reste de la suite. Port dédié (3097), distinct de celui
// d'handlers.race.test.js (3098), pour ne jamais entrer en collision si
// node:test exécute les deux fichiers en parallèle.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';
import dotenv from 'dotenv';
import pg from 'pg';
import { fetchQuestionBank } from '../db/repository.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '../..');
dotenv.config({ path: path.resolve(SERVER_ROOT, '../.env'), quiet: true });

const TEST_PORT = 3097;
const HTTP = `http://localhost:${TEST_PORT}`;
const RUN_ID = Date.now().toString(36).slice(-5);

let serverProcess = null;
let pool = null;
let userCounter = 0;
const createdUserIds = [];
const createdQuestionIds = [];
const createdPackIds = [];
const createdRoomCodes = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(`${HTTP}/health`);
      if (res.ok) return;
    } catch {
      // Pas encore accepté de connexions : normal en tout début de démarrage.
    }
    await sleep(200);
  }
  throw new Error('Le serveur de test ne répond pas sur /health après 15s');
}

async function waitFor(fn, { timeout = 8000, interval = 50 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return;
    await sleep(interval);
  }
  throw new Error('waitFor : condition jamais remplie');
}

async function registerUser(pseudoBase, { langue = 'fr' } = {}) {
  const pseudo = `${pseudoBase}${RUN_ID}${userCounter++}`;
  const email = `${pseudo.toLowerCase()}@e2e-test.local`;
  const res = await fetch(`${HTTP}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pseudo, email, password: 'testpass1234', langue }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`register failed for ${pseudo}: ${JSON.stringify(body)}`);
  createdUserIds.push(body.user.id);
  return body;
}

async function registerGuest(pseudoBase) {
  const pseudo = `${pseudoBase}${RUN_ID}${userCounter++}`;
  const res = await fetch(`${HTTP}/api/auth/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pseudo }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`guest register failed: ${JSON.stringify(body)}`);
  createdUserIds.push(body.user.id);
  return body;
}

async function promoteToAdmin(userId) {
  await pool.query('UPDATE users SET is_admin = true WHERE id = $1', [userId]);
}

async function callHttp(method, urlPath, token, payload) {
  const res = await fetch(`${HTTP}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body };
}

function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const socket = io(HTTP, { auth: { token }, transports: ['websocket'], reconnection: false });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(event, payload, (err, res) => {
      if (err) return resolve({ ok: false, code: 'ACK_TIMEOUT' });
      resolve(res);
    });
  });
}

describe('modération des questions (Phase 5 : 8 exigences empiriques, vrai serveur + vraie base)', () => {
  before(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL manquant (voir .env à la racine) : ces tests ont besoin d'une vraie base.");
    }
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

    let bootLog = '';
    serverProcess = spawn(process.execPath, ['src/index.js'], {
      cwd: SERVER_ROOT,
      env: { ...process.env, PORT: String(TEST_PORT), JWT_SECRET: `test-secret-moderation-${RUN_ID}` },
      stdio: 'pipe',
    });
    serverProcess.stdout.on('data', (d) => {
      bootLog += d.toString();
    });
    serverProcess.stderr.on('data', (d) => {
      bootLog += d.toString();
    });
    serverProcess.on('exit', (code) => {
      if (code !== null && code !== 0) {
        console.error('Le serveur de test (processus enfant) a quitté prématurément :\n', bootLog);
      }
    });

    await waitForHealth();
  });

  after(async () => {
    try {
      if (createdPackIds.length) await pool.query('DELETE FROM pack_questions WHERE pack_id = ANY($1)', [createdPackIds]);
      if (createdQuestionIds.length) await pool.query('DELETE FROM questions WHERE id = ANY($1)', [createdQuestionIds]);
      if (createdPackIds.length) await pool.query('DELETE FROM packs WHERE id = ANY($1)', [createdPackIds]);
      if (createdRoomCodes.length) await pool.query('DELETE FROM rooms WHERE code = ANY($1)', [createdRoomCodes]);
      if (createdUserIds.length) {
        await pool.query('DELETE FROM signalements WHERE user_id = ANY($1)', [createdUserIds]);
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
      }
    } finally {
      await pool?.end();
      if (serverProcess && serverProcess.exitCode === null) {
        serverProcess.kill();
        await new Promise((resolve) => serverProcess.once('exit', resolve));
      }
    }
  });

  test('1. un compte invité est bloqué pour proposer une question', async () => {
    const guest = await registerGuest('E5Guest');
    const res = await callHttp('POST', '/api/questions', guest.token, { type: 'verite', contenu: 'Une question', niveau: 1 });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'GUEST_NOT_ALLOWED');
  });

  test("2. impossible de rattacher une question au pack d'un autre compte", async () => {
    const owner = await registerUser('E5Owner');
    const attacker = await registerUser('E5Attacker');
    const packRes = await pool.query(
      `INSERT INTO packs (owner_id, nom, code, langue) VALUES ($1, 'Pack E5', $2, 'fr') RETURNING id`,
      [owner.user.id, `${RUN_ID}${userCounter}`.slice(0, 6).toUpperCase().padEnd(6, 'X')]
    );
    const packId = packRes.rows[0].id;
    createdPackIds.push(packId);

    const res = await callHttp('POST', '/api/questions', attacker.token, {
      type: 'verite',
      contenu: 'Question intruse',
      niveau: 1,
      packId,
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'PACK_NOT_OWNED');
  });

  test('3. un contenu banni est rejeté avant tout insert en base', async () => {
    const user = await registerUser('E5Banned');
    const contenu = `appel au meurtre - phase 5 ${RUN_ID}`;
    const res = await callHttp('POST', '/api/questions', user.token, { type: 'verite', contenu, niveau: 1 });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'QUESTION_REJECTED_MODERATION');

    const rows = await pool.query('SELECT id FROM questions WHERE contenu = $1', [contenu]);
    assert.equal(rows.rows.length, 0, 'le contenu banni ne doit jamais atteindre la base');
  });

  test('4. un compte non-admin est bloqué sur toutes les routes de modération, même en appel direct', async () => {
    const author = await registerUser('E5Author');
    const proposed = await callHttp('POST', '/api/questions', author.token, {
      type: 'verite',
      contenu: 'Question E5 modération',
      niveau: 1,
    });
    const questionId = proposed.body.question.id;
    createdQuestionIds.push(questionId);

    const nonAdmin = await registerUser('E5NonAdmin');
    const routes = [
      ['GET', '/api/admin/questions/en-attente'],
      ['POST', `/api/admin/questions/${questionId}/approve`],
      ['POST', `/api/admin/questions/${questionId}/reject`],
      ['GET', '/api/admin/questions/signalees'],
      ['POST', `/api/admin/questions/${questionId}/unpublish`],
    ];
    for (const [method, urlPath] of routes) {
      const res = await callHttp(method, urlPath, nonAdmin.token);
      assert.equal(res.status, 403, `${method} ${urlPath} devrait être 403`);
      assert.equal(res.body.code, 'ADMIN_ONLY', `${method} ${urlPath} devrait renvoyer ADMIN_ONLY`);
    }

    // Même l'auteure de la question elle-même, tant qu'elle n'est pas admin.
    const resAsAuthor = await callHttp('GET', '/api/admin/questions/en-attente', author.token);
    assert.equal(resAsAuthor.status, 403);
    assert.equal(resAsAuthor.body.code, 'ADMIN_ONLY');
  });

  test('5. approuver une question la rend immédiatement éligible au tirage normal', async () => {
    const author = await registerUser('E5Elig');
    const admin = await registerUser('E5Admin1');
    await promoteToAdmin(admin.user.id);

    const proposed = await callHttp('POST', '/api/questions', author.token, {
      type: 'verite',
      contenu: 'Question E5 éligibilité',
      niveau: 1,
    });
    const questionId = proposed.body.question.id;
    createdQuestionIds.push(questionId);

    const approveRes = await callHttp('POST', `/api/admin/questions/${questionId}/approve`, admin.token);
    assert.equal(approveRes.status, 200);

    // La même fonction que le jeu utilise réellement pour tirer une question
    // (voir db/repository.js) : pas une simple relecture de colonne.
    const { questionPool } = await fetchQuestionBank(pool, { niveauMax: 1, langue: 'fr', categorie: 'general' });
    const allIds = [
      ...questionPool.verite.top,
      ...questionPool.verite.lower,
      ...questionPool.action.top,
      ...questionPool.action.lower,
    ];
    assert.ok(allIds.includes(questionId), 'la question approuvée doit apparaître dans le pool de tirage');
  });

  test("6. un signalement traité (dépublication) ne perturbe jamais un tour déjà en cours", async () => {
    const alice = await registerUser('E5Alice');
    const bob = await registerUser('E5Bob');
    const admin = await registerUser('E5Admin2');
    await promoteToAdmin(admin.user.id);

    const [aliceSocket, bobSocket] = await Promise.all([connectSocket(alice.token), connectSocket(bob.token)]);
    let dbRoomId = null;
    let questionId = null;
    let originallyPublic = null;
    try {
      let turnStarted = false;
      aliceSocket.on('turn:started', () => {
        turnStarted = true;
      });

      const createRes = await emitAck(aliceSocket, 'room:create', { maxTurns: 2, langue: 'fr' });
      const code = createRes.snapshot.code;
      createdRoomCodes.push(code);
      await emitAck(bobSocket, 'room:join', { code });
      await emitAck(aliceSocket, 'game:start', {});
      await waitFor(() => turnStarted);

      const roomRow = await pool.query('SELECT id FROM rooms WHERE code = $1', [code]);
      dbRoomId = roomRow.rows[0].id;
      const turnRow = await pool.query(
        `SELECT COALESCE(joker_inverse_question_id, question_id) AS question_id FROM turns WHERE room_id = $1 ORDER BY id DESC LIMIT 1`,
        [dbRoomId]
      );
      questionId = turnRow.rows[0].question_id;

      const signalRes = await emitAck(bobSocket, 'turn:signalerQuestion', {});
      assert.equal(signalRes.ok, true);

      const beforeUnpub = await pool.query('SELECT is_public FROM questions WHERE id = $1', [questionId]);
      originallyPublic = beforeUnpub.rows[0].is_public;

      const unpubRes = await callHttp('POST', `/api/admin/questions/${questionId}/unpublish`, admin.token);
      assert.equal(unpubRes.status, 200);

      // Le tour du salon (déjà lancé avec cette question avant même la
      // dépublication) doit continuer à fonctionner : aucune re-vérification
      // de is_public en cours de tour, seuls les FUTURS tirages excluent la
      // question (voir fetchQuestionBank / test 5 ci-dessus).
      let turnResolved = false;
      aliceSocket.on('turn:resolved', () => {
        turnResolved = true;
      });
      // room.turnOrder = ordre d'arrivée des joueurs (voir game/turn.js
      // startGame) : alice, hôte et première arrivée, est donc l'active du
      // premier tour.
      const answerRes = await emitAck(aliceSocket, 'turn:answer', { text: 'réponse malgré la dépublication' });
      assert.equal(answerRes.ok, true, 'le tour déjà en cours doit continuer de fonctionner malgré la dépublication de sa question');
      await waitFor(() => turnResolved);
    } finally {
      aliceSocket.disconnect();
      bobSocket.disconnect();
      // La question touchée fait partie de la banque partagée réelle (pas une
      // donnée de test isolée) : restaurée dans son état d'origine plutôt que
      // laissée dépubliée derrière ce test.
      if (questionId != null && originallyPublic) {
        await pool.query(`UPDATE questions SET moderation = 'public', is_public = true WHERE id = $1`, [questionId]);
      }
      if (questionId != null) {
        await pool.query('DELETE FROM signalements WHERE question_id = $1 AND room_id = $2', [questionId, dbRoomId]);
      }
    }
  });

  test("7. l'auteur ne peut plus modifier ni retirer sa question une fois sortie de en_attente, même en appel direct", async () => {
    const author = await registerUser('E5Edit');
    const admin = await registerUser('E5Admin3');
    await promoteToAdmin(admin.user.id);

    const proposed = await callHttp('POST', '/api/questions', author.token, {
      type: 'verite',
      contenu: 'Question E5 édition verrouillée',
      niveau: 1,
    });
    const questionId = proposed.body.question.id;
    createdQuestionIds.push(questionId);

    const rejectRes = await callHttp('POST', `/api/admin/questions/${questionId}/reject`, admin.token);
    assert.equal(rejectRes.status, 200);

    const editRes = await callHttp('PATCH', `/api/questions/${questionId}`, author.token, {
      type: 'verite',
      contenu: 'tentative de modification',
      niveau: 1,
    });
    assert.equal(editRes.status, 409);
    assert.equal(editRes.body.code, 'QUESTION_NOT_EDITABLE');

    const deleteRes = await callHttp('DELETE', `/api/questions/${questionId}`, author.token);
    assert.equal(deleteRes.status, 409);
    assert.equal(deleteRes.body.code, 'QUESTION_NOT_EDITABLE');
  });

  test('8. "Gérer mes questions" ne montre jamais les questions d\'un autre compte', async () => {
    const alice = await registerUser('E5MineA');
    const bob = await registerUser('E5MineB');

    const propA = await callHttp('POST', '/api/questions', alice.token, {
      type: 'verite',
      contenu: 'Question privée à Alice E5',
      niveau: 1,
    });
    const propB = await callHttp('POST', '/api/questions', bob.token, {
      type: 'verite',
      contenu: 'Question privée à Bob E5',
      niveau: 1,
    });
    createdQuestionIds.push(propA.body.question.id, propB.body.question.id);

    const aliceList = await callHttp('GET', '/api/questions/mine', alice.token);
    const bobList = await callHttp('GET', '/api/questions/mine', bob.token);

    assert.ok(aliceList.body.questions.some((q) => q.id === propA.body.question.id));
    assert.ok(!aliceList.body.questions.some((q) => q.id === propB.body.question.id), 'alice ne doit jamais voir la question de bob');
    assert.ok(bobList.body.questions.some((q) => q.id === propB.body.question.id));
    assert.ok(!bobList.body.questions.some((q) => q.id === propA.body.question.id), "bob ne doit jamais voir la question d'alice");
  });
});
