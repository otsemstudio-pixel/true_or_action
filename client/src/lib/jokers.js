import {
  LeFideleIcon,
  LeMetronomeIcon,
  LIncrevableIcon,
  LeVeteranIcon,
  LeRituelIcon,
} from '../components/jokers/icons/regularite.jsx';

// Registre des jokers, groupés par catégorie. Chaque catégorie porte sa
// propre teinte (colorVar, voir les tokens --color-joker-* dans index.css) ;
// chaque joker n'a qu'un id stable, utilisé pour ses clés de traduction
// (jokers.<categorie>.<id>.nom / .effet, voir fr.js/en.js) et son icône. Le
// nom et le texte d'effet ne vivent jamais ici — toujours dans les
// dictionnaires, comme le reste de l'app.
//
// Phase 2 : les 5 jokers de Régularité. Les 45 restants arrivent catégorie
// par catégorie — toujours en ajoutant ici, jamais en modifiant JokerCard ni
// JokerGallery.
export const JOKER_CATEGORIES = [
  {
    id: 'regularite',
    colorVar: '--color-joker-regularite',
    jokers: [
      { id: 'leFidele', Icon: LeFideleIcon },
      { id: 'leMetronome', Icon: LeMetronomeIcon },
      { id: 'lIncrevable', Icon: LIncrevableIcon },
      { id: 'leVeteran', Icon: LeVeteranIcon },
      { id: 'leRituel', Icon: LeRituelIcon },
    ],
  },
];
