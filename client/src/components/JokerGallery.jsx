import { JOKER_CATEGORIES } from '../lib/jokers.js';
import JokerCategorySection from './JokerCategorySection.jsx';

// Point d'entrée de la galerie : une section par catégorie de JOKER_CATEGORIES.
// N'a jamais besoin d'être modifié pour ajouter des jokers ou des
// catégories — tout passe par lib/jokers.js.
function JokerGallery({ selectedCarteJokerId, onChoose }) {
  return (
    <div className="joker-gallery">
      {JOKER_CATEGORIES.map((categorie) => (
        <JokerCategorySection
          key={categorie.id}
          categorie={categorie}
          selectedCarteJokerId={selectedCarteJokerId}
          onChoose={onChoose}
        />
      ))}
    </div>
  );
}

export default JokerGallery;
