import { useI18n } from '../hooks/useI18n.jsx';
import JokerGallery from './JokerGallery.jsx';

// Point d'accès temporaire pour valider l'architecture de la Phase 1 —
// deviendra aussi le point d'entrée réel une fois l'acquisition en début de
// partie construite (Phase 3 du prompt jokers).
function JokersGalleryModal({ open, onClose }) {
  const { t } = useI18n();

  if (!open) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={t('jokers.titre')}>
      <div className="modal-panel card">
        <div className="modal-header">
          <h2>{t('jokers.titre')}</h2>
          <button type="button" className="link-btn" onClick={onClose}>
            {t('commun.fermer')}
          </button>
        </div>
        <JokerGallery />
      </div>
    </div>
  );
}

export default JokersGalleryModal;
