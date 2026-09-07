import { useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { useI18n } from '../hooks/useI18n.jsx';
import { translateError } from '../i18n/index.js';
import Button from './Button.jsx';
import TextField from './TextField.jsx';
import ErrorBanner from './ErrorBanner.jsx';

// Conversion d'un compte invité en compte complet : tout est conservé côté
// serveur (pseudo, historique, questions, packs) — seuls email et mot de
// passe s'ajoutent. Pas de champ pseudo ici, il ne change pas.
function ConvertirCompteModal({ open, onClose }) {
  const { convertToFullAccount } = useAuth();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await convertToFullAccount({ email, password });
      onClose();
    } catch (err) {
      setError(translateError(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={t('invite.creerUnCompte')}>
      <div className="modal-panel card">
        <div className="modal-header">
          <h2>{t('invite.creerUnCompte')}</h2>
          <button type="button" className="link-btn" onClick={onClose}>
            {t('commun.fermer')}
          </button>
        </div>
        <p className="menu-item-hint">{t('invite.creerUnCompteHint')}</p>

        <form onSubmit={handleSubmit} className="turn-answer-form">
          <TextField
            id="convert-email"
            label={t('accueil.email')}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <TextField
            id="convert-password"
            label={t('accueil.motDePasse')}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint={t('accueil.motDePasseHint')}
            required
          />

          <ErrorBanner>{error}</ErrorBanner>

          <Button type="submit" variant="dark" block arrow busy={busy}>
            {t('invite.creerUnCompte')}
          </Button>
        </form>
      </div>
    </div>
  );
}

export default ConvertirCompteModal;
