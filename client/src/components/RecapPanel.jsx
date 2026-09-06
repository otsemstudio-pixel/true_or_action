import { useEffect, useState } from 'react';
import { useRoom } from '../hooks/useRoom.jsx';
import { useI18n } from '../hooks/useI18n.jsx';
import { translateError } from '../i18n/index.js';
import Spinner from './Spinner.jsx';

// Reconstruit exclusivement depuis la base (table turns) à chaque ouverture —
// jamais depuis l'historique du chat en mémoire, qui ne survit pas à une
// reconnexion ni à un redémarrage serveur.
function RecapPanel({ open, onClose }) {
  const { fetchRecap } = useRoom();
  const { t } = useI18n();
  const [state, setState] = useState({ loading: false, turns: null, error: null });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState({ loading: true, turns: null, error: null });
    fetchRecap()
      .then((res) => {
        if (!cancelled) setState({ loading: false, turns: res.turns, error: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, turns: null, error: translateError(t, err) });
      });
    return () => {
      cancelled = true;
    };
  }, [open, fetchRecap, t]);

  if (!open) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={t('partie.recapitulatif')}>
      <div className="modal-panel card">
        <div className="modal-header">
          <h2>{t('partie.recapitulatif')}</h2>
          <button type="button" className="link-btn" onClick={onClose}>
            {t('commun.fermer')}
          </button>
        </div>

        <div className="recap-list">
          {state.loading && <Spinner />}
          {state.error && <p className="field-error-text">{state.error}</p>}
          {!state.loading && !state.error && state.turns?.length === 0 && (
            <p className="menu-item-hint">{t('partie.recapVide')}</p>
          )}
          {state.turns?.map((turn) => (
            <div key={turn.turnNumber} className="answer-card recap-item">
              <div className="answer-card-header">
                <span className="answer-card-author">{turn.pseudo}</span>
                {turn.type && (
                  <span className={`badge-type badge-type--${turn.type}`}>
                    {turn.type === 'verite' ? t('partie.verite') : t('partie.action')}
                  </span>
                )}
              </div>
              {turn.contenu && <p className="answer-card-question">{turn.contenu}</p>}
              <p className="answer-card-response">
                {turn.answer != null ? t('partie.reponseGuillemet', { reponse: turn.answer }) : t('partie.tempsEcoule')}
              </p>
              <div className="answer-card-footer">
                <span className="answer-card-points">{t('commun.pointsGagnes', { points: turn.points ?? 0 })}</span>
                {turn.votes?.up > 0 && <span className="answer-card-thumbs">{turn.votes.up} 👍</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default RecapPanel;
