import { useI18n } from '../hooks/useI18n.jsx';
import Button from './Button.jsx';

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

function Tutoriel({ open, onClose }) {
  const { t } = useI18n();

  if (!open) return null;

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
        </div>

        <Button block onClick={onClose}>
          {t('didacticiel.compris')}
        </Button>
      </div>
    </div>
  );
}

export default Tutoriel;
