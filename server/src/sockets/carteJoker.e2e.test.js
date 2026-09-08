// Test d'intégration RÉEL (vrai serveur, vraie base) pour l'acquisition des
// cartes joker (Phase 3 du prompt jokers) : le choix d'un joueur doit
// survivre à une reconnexion / un redémarrage serveur (même vigilance que
// pour room.history, corrigé précédemment) — seule la persistance réelle en
// base (room_players.carte_joker) le prouve, pas les tests purs de
// game/jokers.test.js qui ne couvrent que la logique de jeu en mémoire.
//
// Comme handlers.race.test.js et moderation.e2e.test.js (voir ces fichiers
// pour le détail du choix d'architecture) : port dédié (3095), distinct des
// deux autres (3097, 3098), pour ne jamais entrer en collision si node:test
// exécute plusieurs fichiers en parallèle.
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

// Import dynamique, après dotenv.config() ci-dessus : reconstruct.js importe
// transitivement config/env.js, qui valide DATABASE_URL/JWT_SECRET dès
// l'import — un import statique en tête de fichier s'exécuterait avant que
// dotenv n'ait eu la chance de les poser (les imports sont hoistés avant le
// reste du module, voir le même problème déjà rencontré et documenté dans
// turnReconstruction.js).
const { fetchRoomByCode } = await import('../db/repository.js');
const { loadRoomEntryFromDb } = await import('./reconstruct.js');

const TEST_PORT = 3095;
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
  const pseudo = `${pseudoBase}${RUN_ID}`;
  const res = await fetch(`${HTTP}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pseudo, email: `${pseudo.toLowerCase()}@e2e-test.local`, password: 'testpass1234', langue: 'fr' }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`register failed for ${pseudo}: ${JSON.stringify(body)}`);
  createdUserIds.push(body.user.id);
  return body;
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

describe('acquisition des cartes joker : persistance réelle et survie à une reconnexion', () => {
  let aliceSocket;
  let bobSocket;

  before(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL manquant (voir .env à la racine) : ce test a besoin d'une vraie base.");
    }
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

    let bootLog = '';
    serverProcess = spawn(process.execPath, ['src/index.js'], {
      cwd: SERVER_ROOT,
      env: { ...process.env, PORT: String(TEST_PORT), JWT_SECRET: `test-secret-cartejoker-${RUN_ID}` },
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

    const alice = await registerUser('CjAlice');
    const bob = await registerUser('CjBob');
    [aliceSocket, bobSocket] = await Promise.all([connectSocket(alice.token), connectSocket(bob.token)]);
    aliceSocket.__user = alice.user;
    bobSocket.__user = bob.user;
  });

  after(async () => {
    try {
      aliceSocket?.disconnect();
      bobSocket?.disconnect();
      if (createdRoomCodes.length) await pool.query('DELETE FROM rooms WHERE code = ANY($1)', [createdRoomCodes]);
      if (createdUserIds.length) await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
    } finally {
      await pool?.end();
      if (serverProcess && serverProcess.exitCode === null) {
        serverProcess.kill();
        await new Promise((resolve) => serverProcess.once('exit', resolve));
      }
    }
  });

  test('un choix de carte est persisté en base et reste lisible après une reconstruction complète (reconnexion/redémarrage)', async () => {
    const createRes = await emitAck(aliceSocket, 'room:create', { maxTurns: 2, langue: 'fr' });
    assert.equal(createRes.ok, true);
    const code = createRes.snapshot.code;
    createdRoomCodes.push(code);
    await emitAck(bobSocket, 'room:join', { code });

    await emitAck(aliceSocket, 'room:regles', { carteJoker: true });
    await emitAck(aliceSocket, 'room:choisirCarteJoker', { carteJokerId: 'leFidele' });
    await emitAck(bobSocket, 'room:choisirCarteJoker', { carteJokerId: 'leVeteran' });

    let turnStarted = false;
    aliceSocket.on('turn:started', () => {
      turnStarted = true;
    });
    const startRes = await emitAck(aliceSocket, 'game:start', {});
    assert.equal(startRes.ok, true);
    await waitFor(() => turnStarted);

    // Vérité de référence : ce que la mémoire du process contient réellement
    // (on ne peut pas lire entry.room directement depuis ce script, donc on
    // vérifie la base — seule source de vérité après une vraie reconnexion,
    // voir loadRoomEntryFromDb ci-dessous qui l'utilise exactement pareil).
    const dbRows = await pool.query(
      `SELECT rp.user_id, rp.carte_joker FROM room_players rp JOIN rooms r ON r.id = rp.room_id WHERE r.code = $1`,
      [code]
    );
    const byUserId = Object.fromEntries(dbRows.rows.map((r) => [r.user_id, r.carte_joker]));
    assert.equal(byUserId[aliceSocket.__user.id], 'leFidele');
    assert.equal(byUserId[bobSocket.__user.id], 'leVeteran');

    // Reconstruction complète, exactement le chemin emprunté par une vraie
    // reconnexion ou un redémarrage serveur (voir sockets/reconstruct.js).
    const roomRow = await fetchRoomByCode(pool, code);
    const { entry } = await loadRoomEntryFromDb(roomRow);
    const aliceReconstructed = entry.room.players.find((p) => p.id === String(aliceSocket.__user.id));
    const bobReconstructed = entry.room.players.find((p) => p.id === String(bobSocket.__user.id));
    assert.equal(aliceReconstructed?.carteJoker, 'leFidele', 'la carte d’alice doit survivre à la reconstruction');
    assert.equal(bobReconstructed?.carteJoker, 'leVeteran', 'la carte de bob doit survivre à la reconstruction');
  });
});
