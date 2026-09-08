import { useState } from 'react';

// Carte générique, pensée pour les 50 jokers à venir sans jamais être
// retouchée une fois cette architecture validée (voir le prompt) : tout ce
// qui varie d'un joker à l'autre passe en props (icône, nom, texte d'effet,
// teinte de catégorie), jamais en dur ici.
//
// `illustration` accepte n'importe quel nœud React : un composant SVG
// (<LeFideleIcon />) aujourd'hui, une <img src="..."/> demain si une
// illustration devient une image — la carte ne fait aucune distinction entre
// les deux, elle affiche simplement ce qu'on lui donne dans son emplacement
// dédié, sans jamais mélanger le tracé de l'icône à sa propre structure.
//
// Le texte d'effet n'apparaît jamais en permanence sur la face visible :
// seulement au clic/tap (retournement), avec un aperçu au survol en confort
// supplémentaire sur desktop (jamais en remplacement du clic, voir le CSS
// media hover:hover).
//
// `onChoose` (+ `chosen`, `chooseLabel`, `chosenLabel`) est optionnel : sans
// lui, la carte se comporte exactement comme en Phase 1/2 (galerie de
// consultation depuis le menu) — seul le salon d'attente (Phase 3) les
// fournit, pour ajouter un bouton de sélection sur la face arrière sans
// toucher au comportement par défaut ni à la mécanique de retournement.
function JokerCard({ nom, effet, illustration, colorVar, chosen = false, onChoose, chooseLabel, chosenLabel }) {
  const [flipped, setFlipped] = useState(false);

  const toggle = () => setFlipped((f) => !f);
  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  };
  // Empêche le clic sur le bouton de retourner la carte par-dessus (l'un et
  // l'autre partagent sinon le même gestionnaire, la carte étant elle-même
  // le déclencheur du retournement).
  const handleChoose = (e) => {
    e.stopPropagation();
    onChoose?.();
  };

  return (
    <div
      className={`joker-card${chosen ? ' joker-card--chosen' : ''}`}
      style={{ '--joker-color': `var(${colorVar})`, '--joker-color-wash': `var(${colorVar}-wash)` }}
      role="button"
      tabIndex={0}
      aria-pressed={flipped}
      aria-label={`${nom} — ${effet}`}
      onClick={toggle}
      onKeyDown={onKeyDown}
    >
      <div className={`joker-card-inner${flipped ? ' joker-card-inner--flipped' : ''}`}>
        <div className="joker-card-face joker-card-face--front">
          <span className="joker-card-index joker-card-index--top" aria-hidden="true">
            T
          </span>
          <span className="joker-card-index joker-card-index--bottom" aria-hidden="true">
            D
          </span>
          <div className="joker-card-illustration">{illustration}</div>
          <p className="joker-card-nom">{nom}</p>
          <p className="joker-card-hint" aria-hidden="true">
            {effet}
          </p>
        </div>
        <div className="joker-card-face joker-card-face--back">
          <p className="joker-card-effet">{effet}</p>
          {onChoose && (
            <button type="button" className="joker-card-choose-btn" onClick={handleChoose}>
              {chosen ? chosenLabel : chooseLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default JokerCard;
