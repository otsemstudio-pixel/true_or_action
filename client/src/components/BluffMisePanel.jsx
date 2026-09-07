import { useEffect, useState } from 'react';
import Button from './Button.jsx';
import ErrorBanner from './ErrorBanner.jsx';
import { useI18n } from '../hooks/useI18n.jsx';
import { translateError } from '../i18n/index.js';

const MONTANTS = [1, 2];

// Règle G : mise secrète sur la sincérité du joueur actif, offerte à tout
// votant sur CHAQUE tour dès que la règle est active — jamais seulement
// quand un bluff a réellement été déclaré, sinon l'apparition même de ce
// panneau trahirait la déclaration cachée (voir game/turn.js declareBluff).
// "envoyé" reste un état local, comme pour PariMutuelPanel : rien n'est
// jamais diffusé avant la résolution du tour.
function BluffMisePanel({ turn, myId, onSubmitMise }) {
  const { t } = useI18n();
  const [montant, setMontant] = useState(1);
  const [prediction, setPrediction] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    setMontant(1);
    setPrediction(null);
    setBusy(false);
    setError(null);
    setSent(false);
  }, [turn?.turnNumber]);

  if (!turn || turn.mode !== 'normal' || turn.phase !== 'voting' || turn.activePlayerId === myId) {
    return null;
  }

  const handleSubmit = async () => {
    if (!prediction) return;
    setError(null);
    setBusy(true);
    try {
      await onSubmitMise(montant, prediction);
      setSent(true);
    } catch (err) {
      setError(translateError(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="turn-panel">
      <ErrorBanner>{error}</ErrorBanner>
      {sent ? (
        <p className="menu-item-hint">{t('partie.miseEnvoyee')}</p>
      ) : (
        <div className="turn-answer-form">
          <p className="turn-question">{t('partie.miseTitre')}</p>
          <div className="vote-buttons">
            <button
              type="button"
              className={`regle-switch${prediction === 'vrai' ? ' regle-switch--active' : ''}`}
              disabled={busy}
              onClick={() => setPrediction('vrai')}
            >
              {t('partie.miseVrai')}
            </button>
            <button
              type="button"
              className={`regle-switch${prediction === 'faux' ? ' regle-switch--active' : ''}`}
              disabled={busy}
              onClick={() => setPrediction('faux')}
            >
              {t('partie.miseFaux')}
            </button>
          </div>
          <div className="vote-buttons">
            {MONTANTS.map((m) => (
              <button
                key={m}
                type="button"
                className={`regle-switch${montant === m ? ' regle-switch--active' : ''}`}
                disabled={busy}
                onClick={() => setMontant(m)}
              >
                {t('partie.miseMontant', { montant: m })}
              </button>
            ))}
          </div>
          <Button variant="secondary" block busy={busy} disabled={!prediction} onClick={handleSubmit}>
            {t('partie.miseEnvoyer')}
          </Button>
        </div>
      )}
    </div>
  );
}

export default BluffMisePanel;
