import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRoomEntry, runExclusive } from './store.js';

// Manquait à la liste de tests de l'audit précédent : la garantie derrière
// "deux joueurs activent le joker au même instant" ou "une même mise
// envoyée deux fois en course" n'était jusqu'ici prouvée qu'au niveau des
// fonctions pures de game/turn.js (deux appels successifs sur le même objet
// mémoire) ou ponctuellement en direct contre un vrai serveur — jamais au
// niveau du mécanisme qui les protège réellement, runExclusive lui-même.
// Ces tests le prouvent une fois pour toutes, pour n'importe quelle action
// future, plutôt que de le re-prouver séparément pour chaque règle.

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('runExclusive : sérialisation des actions concurrentes sur un même salon', () => {
  test('deux actions lancées en vraie course (Promise.all) s\'exécutent l\'une après l\'autre, jamais entrelacées', async () => {
    const entry = createRoomEntry({});
    const log = [];

    // La plus lente (A) est lancée en premier : sans runExclusive, la plus
    // rapide (B) terminerait avant elle et le journal serait entrelacé
    // (A:start, B:start, B:end, A:end) — exactement le scénario "deux
    // joueurs activent le joker au même instant" ou "une mise envoyée deux
    // fois en course" de l'audit.
    const actionA = runExclusive(entry, async () => {
      log.push('A:start');
      await sleep(20); // simule un aller-retour base de données
      log.push('A:end');
    });
    const actionB = runExclusive(entry, async () => {
      log.push('B:start');
      await sleep(5);
      log.push('B:end');
    });

    await Promise.all([actionA, actionB]);

    assert.deepEqual(log, ['A:start', 'A:end', 'B:start', 'B:end']);
  });

  test('trois actions en vraie course s\'exécutent toutes, dans l\'ordre où elles ont rejoint la file', async () => {
    const entry = createRoomEntry({});
    const log = [];
    const queue = (name, delay) =>
      runExclusive(entry, async () => {
        log.push(`${name}:start`);
        await sleep(delay);
        log.push(`${name}:end`);
      });

    // Volontairement la plus lente en premier, la plus rapide en dernier :
    // seul l'ordre d'appel doit déterminer l'ordre d'exécution, jamais la
    // durée de chacune.
    await Promise.all([queue('A', 15), queue('B', 1), queue('C', 10)]);

    assert.deepEqual(log, ['A:start', 'A:end', 'B:start', 'B:end', 'C:start', 'C:end']);
  });

  test('une action qui échoue ne bloque jamais la file : la suivante s\'exécute quand même', async () => {
    const entry = createRoomEntry({});
    const log = [];

    const failing = runExclusive(entry, async () => {
      log.push('failing');
      throw new Error('échec délibéré');
    });
    await assert.rejects(failing);

    await runExclusive(entry, async () => {
      log.push('following');
    });

    assert.deepEqual(log, ['failing', 'following']);
  });
});
