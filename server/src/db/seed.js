import { pool } from './pool.js';

const VERITE = [
  "Quel est le mensonge le plus énorme que tu aies raconté à tes parents ?",
  "Quelle est la chose la plus gênante qui te soit arrivée en public ?",
  "As-tu déjà eu le béguin pour l'ami(e) de quelqu'un d'autre dans ce groupe ?",
  "Quel est ton pire souvenir de rendez-vous ?",
  "Quelle appli regardes-tu le plus alors que tu ne devrais pas ?",
  "Quel secret n'as-tu jamais dit à personne ici ?",
  "Quelle est la pire excuse que tu aies inventée pour éviter quelqu'un ?",
  "Qui, dans cette partie, ferait le meilleur couple selon toi ?",
  "Quelle est la chose la plus folle que tu aies faite par amour ?",
  "Quel est ton plus grand regret de cette année ?",
  "As-tu déjà triché à un jeu pour gagner ?",
  "Quelle est la dernière chose pour laquelle tu as menti aujourd'hui ?",
];

const ACTION = [
  "Imite la façon de parler du joueur à ta droite pendant 30 secondes.",
  "Envoie un message vocal absurde à ton dernier contact.",
  "Chante le refrain de ta chanson préférée a cappella.",
  "Fais 10 pompes ou raconte ta pire honte au choix du groupe.",
  "Parle avec un accent au choix du groupe jusqu'à ton prochain tour.",
  "Laisse un joueur poster un statut de son choix sur ton téléphone (texte uniquement).",
  "Récite l'alphabet à l'envers en moins de 20 secondes.",
  "Fais une déclaration d'amour improvisée à un objet dans la pièce.",
  "Danse 15 secondes sans musique devant tout le monde.",
  "Raconte une blague, si personne ne rit tu bois un verre d'eau cul sec.",
  "Décris ta journée comme un commentateur sportif pendant 30 secondes.",
  "Échange de pseudo avec un autre joueur jusqu'à la fin de la partie.",
];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const contenu of VERITE) {
      await client.query(
        `INSERT INTO questions (type, contenu, is_public, niveau) VALUES ('verite', $1, true, 1)`,
        [contenu]
      );
    }
    for (const contenu of ACTION) {
      await client.query(
        `INSERT INTO questions (type, contenu, is_public, niveau) VALUES ('action', $1, true, 1)`,
        [contenu]
      );
    }

    await client.query('COMMIT');
    console.log(`Seed terminé : ${VERITE.length} vérité + ${ACTION.length} action insérées.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Échec du seed:', err.code || err.name || 'erreur inconnue');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
