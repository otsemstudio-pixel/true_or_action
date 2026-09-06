import { useI18n } from '../hooks/useI18n.jsx';
import Button from './Button.jsx';
import { REGLE_KEYS } from './ReglesActives.jsx';

const POINTS_VERITE = 1;
const POINTS_ACTION = 2;
const VOTE_BONUS = 1;
const ANSWER_SECONDS = 90;
const VOTE_SECONDS = 30;

const SECTIONS = [
  { icon: '🎡', titre: 'tourTitre', texte: 'tourTexte' },
  { icon: '⭐', titre: 'pointsTitre', texte: 'pointsTexte' },
  { icon: '⏱️', titre: 'tempsTitre', texte: 'tempsTexte' },
  { icon: '🎚️', titre: 'niveauxTitre', texte: 'niveauxTexte' },
  { icon: '👍', titre: 'voteTitre', texte: 'voteTexte' },
];

// Le didacticiel explique en plus chaque règle optionnelle actuellement
// activée dans le salon — pas les cinq à chaque fois, pour ne pas noyer un
// joueur qui joue sans elles. `regles` est absent hors d'un salon (menu
// principal) : dans ce cas aucune section de règle n'est ajoutée.
function reglesActivees(regles) {
  if (!regles) return [];
  return REGLE_KEYS.filter((key) => regles[key]);
}

function Tutoriel({ open, onClose, regles }) {
  const { t } = useI18n();

  if (!open) return null;

  const activeRegles = reglesActivees(regles);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={t('didacticiel.titre')}>
      <div className="modal-panel card tutoriel-panel">
        <div className="modal-header">
          <h2>{t('didacticiel.titre')}</h2>
        </div>

        <div className="tutoriel-sections">
          {SECTIONS.map((section) => (
            <div className="tutoriel-section" key={section.titre}>
              <span className="tutoriel-icon" aria-hidden="true">
                {section.icon}
              </span>
              <div>
                <h3>{t(`didacticiel.${section.titre}`)}</h3>
                <p>
                  {t(`didacticiel.${section.texte}`, {
                    verite: POINTS_VERITE,
                    action: POINTS_ACTION,
                    bonus: VOTE_BONUS,
                    answer: ANSWER_SECONDS,
                    vote: VOTE_SECONDS,
                  })}
                </p>
              </div>
            </div>
          ))}

          {activeRegles.length > 0 && (
            <>
              <h3 className="tutoriel-regles-titre">{t('salon.reglesDuJeu')}</h3>
              {activeRegles.map((key) => (
                <div className="tutoriel-section" key={key}>
                  <span className="tutoriel-icon" aria-hidden="true">
                    🎲
                  </span>
                  <div>
                    <h3>{t(`regles.${key}.nom`)}</h3>
                    <p>{t(`regles.${key}.description`)}</p>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <Button block onClick={onClose}>
          {t('didacticiel.compris')}
        </Button>
      </div>
    </div>
  );
}

export default Tutoriel;
