// Courses concurrentes RÉELLES (deux vraies sockets contre un vrai serveur
// et une vraie base), pas une simulation séquentielle — déjà vérifiées
// ponctuellement pendant l'audit post-déploiement des 4 nouvelles règles,
// ajoutées ici pour qu'elles continuent d'être vérifiées à chaque exécution.
// store.test.js prouve déjà que runExclusive sérialise correctement deux
// actions en course, une fois pour toutes, au niveau du mécanisme lui-même ;
// ce fichier-ci vérifie que cette garantie tient bien pour les deux
// scénarios concrets identifiés lors de l'audit (activation du joker,
// mise de bluff), de bout en bout, y compris la persistance en base.
//
// Seul fichier de la suite à dépendre d'une vraie base (DATABASE_URL, voir
// .env à la racine) et à faire tourner un vrai serveur (processus enfant,
// jamais le processus de test lui-même) : isolé ici plutôt que mélangé aux
// tests purs du reste de la suite.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '../..');
dotenv.config({ path: path.resolve(SERVER_ROOT, '../.env'), quiet: true });

// Port dédié, distinct du 3000 par défaut : un serveur de dev tourne parfois
// déjà là pendant qu'on exécute la suite, ce fichier ne doit jamais s'y heurter.
const TEST_PORT = 3098;
const HTTP = `http://localhost:${TEST_PORT}`;
const RUN_ID = Date.now().toString(36).slice(-5);

let serverProcess = null;
let pool = null;
const createdUserIds = [];
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

async function registerUser(pseudoBase) {
  const pseudo = `${pseudoBase}_${RUN_ID}`;
  const email = `${pseudo.toLowerCase()}.${Math.floor(Math.random() * 1e6)}@e2e-test.local`;
  const res = await fetch(`${HTTP}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pseudo, email, password: 'testpass1234' }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`register failed for ${pseudo}: ${JSON.stringify(body)}`);
  createdUserIds.push(body.user.id);
  return { token: body.token, id: String(body.user.id) };
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

describe('courses concurrentes réelles (deux vraies sockets) sur le joker et la mise de bluff', () => {
  before(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL manquant (voir .env à la racine) : ces tests ont besoin d'une vraie base.");
    }
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

    let bootLog = '';
    serverProcess = spawn(process.execPath, ['src/index.js'], {
      cwd: SERVER_ROOT,
      env: { ...process.env, PORT: String(TEST_PORT), JWT_SECRET: `test-secret-race-${RUN_ID}` },
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
      if (createdRoomCodes.length > 0) await pool.query('DELETE FROM rooms WHERE code = ANY($1)', [createdRoomCodes]);
      if (createdUserIds.length > 0) await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
    } finally {
      await pool?.end();
      if (serverProcess && serverProcess.exitCode === null) {
        serverProcess.kill();
        await new Promise((resolve) => serverProcess.once('exit', resolve));
      }
    }
  });

  test('deux joueurs différents activant le joker du public au même instant : un seul est réellement compté', async () => {
    const alice = await registerUser('RaceJkA');
    const bob = await registerUser('RaceJkB');
    const carol = await registerUser('RaceJkC');
    const [aliceSocket, bobSocket, carolSocket] = await Promise.all([
      connectSocket(alice.token),
      connectSocket(bob.token),
      connectSocket(carol.token),
    ]);
    let turnStarted = false;
    aliceSocket.on('turn:started', () => {
      turnStarted = true;
    });

    const createRes = await emitAck(aliceSocket, 'room:create', { maxTurns: 1, langue: 'fr' });
    assert.equal(createRes.ok, true, `room:create a échoué : ${createRes.code}`);
    const code = createRes.snapshot.code;
    createdRoomCodes.push(code);
    await emitAck(bobSocket, 'room:join', { code });
    await emitAck(carolSocket, 'room:join', { code });
    await emitAck(aliceSocket, 'room:regles', { jokerPublic: true });
    await emitAck(aliceSocket, 'game:start', {});
    await waitFor(() => turnStarted);

    // Vraie course (Promise.all, jamais séquentiellement) : sans le verrou
    // par salon (runExclusive), les deux activations pourraient s'appliquer.
    const [bobRes, carolRes] = await Promise.all([
      emitAck(bobSocket, 'turn:joker', { effect: 'style' }),
      emitAck(carolSocket, 'turn:joker', { effect: 'style' }),
    ]);
    assert.equal(bobRes.ok, true);
    assert.equal(carolRes.ok, true, 'la seconde activation est acceptée mais ignorée silencieusement, jamais une erreur');

    await sleep(300); // laisse la persistance (transaction) du gagnant se terminer
    const usage = await pool.query(
      `SELECT ru.player_id FROM regle_usages ru
       JOIN parties p ON p.id = ru.partie_id JOIN rooms r ON r.id = p.room_id
       WHERE r.code = $1 AND ru.regle = 'jokerPublic'`,
      [code]
    );
    assert.equal(usage.rows.length, 1, `un seul joker réellement consommé en base malgré la course (reçu ${usage.rows.length})`);
  });

  test('une même mise de bluff envoyée deux fois par le même joueur en vraie course : une seule est réellement enregistrée', async () => {
    const alice = await registerUser('RaceMsA');
    const bob = await registerUser('RaceMsB');
    const carol = await registerUser('RaceMsC');
    const [aliceSocket, bobSocket, carolSocket] = await Promise.all([
      connectSocket(alice.token),
      connectSocket(bob.token),
      connectSocket(carol.token),
    ]);
    let turnStarted = false;
    aliceSocket.on('turn:started', () => {
      turnStarted = true;
    });

    const createRes = await emitAck(aliceSocket, 'room:create', { maxTurns: 1, langue: 'fr' });
    assert.equal(createRes.ok, true, `room:create a échoué : ${createRes.code}`);
    const code = createRes.snapshot.code;
    createdRoomCodes.push(code);
    await emitAck(bobSocket, 'room:join', { code });
    await emitAck(carolSocket, 'room:join', { code });
    await emitAck(aliceSocket, 'room:regles', { bluffAssume: true });
    await emitAck(aliceSocket, 'game:start', {});
    await waitFor(() => turnStarted);
    await emitAck(aliceSocket, 'turn:answer', { text: 'réponse' });
    await emitAck(aliceSocket, 'turn:bluffDeclare', {});

    const [res1, res2] = await Promise.all([
      emitAck(bobSocket, 'turn:bluffMise', { montant: 1, prediction: 'faux' }),
      emitAck(bobSocket, 'turn:bluffMise', { montant: 2, prediction: 'vrai' }),
    ]);
    const oks = [res1, res2].filter((r) => r.ok === true).length;
    assert.equal(oks, 1, `exactement une des deux mises simultanées de Bob doit réussir (reçu ${oks})`);

    await sleep(300);
    const rows = await pool.query(
      `SELECT montant, prediction FROM bluff_mises bm
       JOIN turns t ON t.id = bm.turn_id JOIN rooms r ON r.id = t.room_id
       WHERE r.code = $1 AND bm.voter_id = $2`,
      [code, Number(bob.id)]
    );
    assert.equal(rows.rows.length, 1, `une seule ligne de mise pour Bob en base malgré la course (reçu ${rows.rows.length})`);

    // Résout le tour proprement plutôt que de laisser un salon de test orphelin.
    await emitAck(carolSocket, 'turn:vote', { vote: 'down' });
    await emitAck(bobSocket, 'turn:vote', { vote: 'down' });
  });
});
