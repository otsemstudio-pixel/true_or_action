import { useEffect, useState } from 'react';
import { useI18n } from '../hooks/useI18n.jsx';
import Button from './Button.jsx';
import { REGLE_KEYS } from './ReglesActives.jsx';

const POINTS_VERITE = 1;
const POINTS_ACTION = 2;
const VOTE_BONUS = 1;
const DEFAULT_ANSWER_SECONDS = 45;
const VOTE_SECONDS = 30;

// L'essentiel du déroulé d'un tour : toujours affiché en premier, jamais
// replié — le reste (niveaux, mode couple, langue, règles, chat, récap) est
// affiché à la demande pour ne pas noyer un nouveau joueur sous un mur de texte.
const ESSENTIEL = [
  { icon: '🎡', titre: 'tourTitre', texte: 'tourTexte' },
  { icon: '⭐', titre: 'pointsTitre', texte: 'pointsTexte' },
  { icon: '⏱️', titre: 'tempsTitre', texte: 'tempsTexte' },
  { icon: '👍', titre: 'voteTitre', texte: 'voteTexte' },
];

// Sections consultables à la demande, repliées par défaut. `visible` décide
// si la section a un sens dans le contexte courant (menu, salon general, ou
// salon couple) ; `render` produit son contenu, propre à chacune (texte
// simple pour la plupart, liste des règles actives pour "regles").
function buildSections({ t, categorie, isCouple }) {
  const sections = [
    {
      key: 'niveaux',
      icon: '🎚️',
      titre: t('didacticiel.niveauxTitre'),
      visible: !isCouple,
      texte: t('didacticiel.niveauxTexte'),
    },
    {
      key: 'couple',
      icon: '💞',
      titre: t('didacticiel.coupleTitre'),
      visible: true,
      texte: t('didacticiel.coupleTexte'),
    },
    {
      key: 'langue',
      icon: '🌐',
      titre: t('didacticiel.langueTitre'),
      visible: true,
      texte: t('didacticiel.langueTexte'),
    },
    {
      key: 'reponse',
      icon: '↩️',
      titre: t('didacticiel.reponseTitre'),
      visible: true,
      texte: t('didacticiel.reponseTexte'),
    },
    {
      key: 'recap',
      icon: '📋',
      titre: t('didacticiel.recapTitre'),
      visible: true,
      texte: t('didacticiel.recapTexte'),
    },
  ];
  return sections.filter((s) => s.visible);
}

// Hors salon (menu), les cinq règles sont toutes présentées à titre
// informatif. Dans un salon, seules celles réellement activées sont
// détaillées — categorie n'a pas besoin d'être testée séparément pour le
// double ou rien : effectiveRegles côté serveur l'a déjà masqué en couple,
// il n'apparaît donc jamais comme activé dans `regles` à ce moment-là.
function reglesAExpliquer(regles) {
  if (!regles) return REGLE_KEYS;
  return REGLE_KEYS.filter((key) => regles[key]);
}

function NouveautesView({ t, onVoirTout, onClose }) {
  const items = [
    { icon: '💞', titre: t('didacticiel.coupleTitre'), texte: t('didacticiel.coupleTexte') },
    { icon: '🌐', titre: t('didacticiel.langueTitre'), texte: t('didacticiel.langueTexte') },
    { icon: '🎲', titre: t('didacticiel.reglesTitre'), texte: REGLE_KEYS.map((k) => t(`regles.${k}.nom`)).join(' · ') },
    { icon: '↩️', titre: t('didacticiel.reponseTitre'), texte: t('didacticiel.reponseTexte') },
    { icon: '📋', titre: t('didacticiel.recapTitre'), texte: t('didacticiel.recapTexte') },
  ];

  return (
    <>
      <div className="modal-header">
        <h2>{t('didacticiel.nouveautesTitre')}</h2>
      </div>
      <p className="menu-item-hint">{t('didacticiel.nouveautesIntro')}</p>
      <div className="tutoriel-sections">
        {items.map((item) => (
          <div className="tutoriel-section" key={item.titre}>
            <span className="tutoriel-icon" aria-hidden="true">
              {item.icon}
            </span>
            <div>
              <h3>{item.titre}</h3>
              <p>{item.texte}</p>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="link-btn" onClick={onVoirTout}>
        {t('didacticiel.voirDidacticielComplet')}
      </button>
      <Button block onClick={onClose}>
        {t('didacticiel.compris')}
      </Button>
    </>
  );
}

function Tutoriel({ open, onClose, regles, categorie, answerSec = DEFAULT_ANSWER_SECONDS, initialView = 'full' }) {
  const { t } = useI18n();
  const [view, setView] = useState(initialView);
  const [openSection, setOpenSection] = useState(null);

  // Le composant ne démonte jamais (juste `open ? … : null`) : sans cet
  // effet, rouvrir avec un `initialView` différent (nouveautés à l'ouverture
  // automatique, puis "Comment jouer" en vue complète) laisserait `view`
  // bloqué sur la toute première valeur reçue au montage.
  useEffect(() => {
    if (open) setView(initialView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  if (view === 'nouveautes') {
    return (
      <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={t('didacticiel.nouveautesTitre')}>
        <div className="modal-panel card tutoriel-panel">
          <NouveautesView t={t} onVoirTout={() => setView('full')} onClose={onClose} />
        </div>
      </div>
    );
  }

  const isCouple = categorie === 'couple';
  const sections = buildSections({ t, categorie, isCouple });
  const activeRegles = reglesAExpliquer(regles);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={t('didacticiel.titre')}>
      <div className="modal-panel card tutoriel-panel">
        <div className="modal-header">
          <h2>{t('didacticiel.titre')}</h2>
        </div>

        <div className="tutoriel-sections">
          <h3 className="tutoriel-groupe-titre">{t('didacticiel.essentielTitre')}</h3>
          {ESSENTIEL.map((section) => (
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
                    answer: answerSec,
                    vote: VOTE_SECONDS,
                  })}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="tutoriel-accordion">
          {sections.map((section) => {
            const isOpen = openSection === section.key;
            return (
              <div className="tutoriel-accordion-item" key={section.key}>
                <button
                  type="button"
                  className="tutoriel-accordion-header"
                  aria-expanded={isOpen}
                  onClick={() => setOpenSection(isOpen ? null : section.key)}
                >
                  <span className="tutoriel-icon" aria-hidden="true">
                    {section.icon}
                  </span>
                  <span className="tutoriel-accordion-titre">{section.titre}</span>
                  <span className="tutoriel-accordion-chevron" aria-hidden="true">
                    {isOpen ? '−' : '+'}
                  </span>
                </button>
                {isOpen && <p className="tutoriel-accordion-content">{section.texte}</p>}
              </div>
            );
          })}

          <div className="tutoriel-accordion-item">
            <button
              type="button"
              className="tutoriel-accordion-header"
              aria-expanded={openSection === 'regles'}
              onClick={() => setOpenSection(openSection === 'regles' ? null : 'regles')}
            >
              <span className="tutoriel-icon" aria-hidden="true">
                🎲
              </span>
              <span className="tutoriel-accordion-titre">{t('didacticiel.reglesTitre')}</span>
              <span className="tutoriel-accordion-chevron" aria-hidden="true">
                {openSection === 'regles' ? '−' : '+'}
              </span>
            </button>
            {openSection === 'regles' &&
              (activeRegles.length > 0 ? (
                <div className="tutoriel-sections tutoriel-sections--nested">
                  {activeRegles.map((key) => (
                    <div className="tutoriel-section" key={key}>
                      <div>
                        <h3>{t(`regles.${key}.nom`)}</h3>
                        <p>{t(`regles.${key}.description`)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="tutoriel-accordion-content">{t('didacticiel.reglesAucuneActive')}</p>
              ))}
          </div>
        </div>

        <Button block onClick={onClose}>
          {t('didacticiel.compris')}
        </Button>
      </div>
    </div>
  );
}

export default Tutoriel;
