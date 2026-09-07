import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { useI18n } from '../hooks/useI18n.jsx';
import { translateError } from '../i18n/index.js';
import Button from './Button.jsx';
import ErrorBanner from './ErrorBanner.jsx';

// Réservée à l'admin unique du projet (users.is_admin, attribué manuellement
// en base — voir auth/middleware.js requireAdmin) : le bouton qui ouvre cette
// modale n'est qu'un raccourci d'affichage, requireAdmin revérifie de toute
// façon en base à chaque appel, jamais une histoire de confiance côté client.
function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function AdminModerationModal({ open, onClose }) {
  const {
    fetchPendingQuestions,
    approvePendingQuestion,
    rejectPendingQuestion,
    fetchReportedQuestions,
    unpublishQuestion,
  } = useAuth();
  const { t } = useI18n();
  const [tab, setTab] = useState('enAttente'); // 'enAttente' | 'signalees'
  const [questions, setQuestions] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = (currentTab = tab) => {
    setError(null);
    setQuestions(null);
    const fetcher = currentTab === 'signalees' ? fetchReportedQuestions : fetchPendingQuestions;
    fetcher()
      .then(({ questions }) => setQuestions(questions))
      .catch((err) => setError(translateError(t, err)));
  };

  useEffect(() => {
    if (open) load(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab]);

  if (!open) return null;

  const handleApprove = async (id) => {
    setBusyId(id);
    setError(null);
    try {
      await approvePendingQuestion(id);
      load();
    } catch (err) {
      setError(translateError(t, err));
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (id) => {
    setBusyId(id);
    setError(null);
    try {
      await rejectPendingQuestion(id);
      load();
    } catch (err) {
      setError(translateError(t, err));
    } finally {
      setBusyId(null);
    }
  };

  const handleUnpublish = async (id) => {
    setBusyId(id);
    setError(null);
    try {
      await unpublishQuestion(id);
      load();
    } catch (err) {
      setError(translateError(t, err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={t('moderation.titre')}>
      <div className="modal-panel card">
        <div className="modal-header">
          <h2>{t('moderation.titre')}</h2>
          <button type="button" className="link-btn" onClick={onClose}>
            {t('commun.fermer')}
          </button>
        </div>

        <div className="settings-mode">
          <button
            type="button"
            className={`btn btn-ghost${tab === 'enAttente' ? ' btn-mode-active' : ''}`}
            onClick={() => setTab('enAttente')}
          >
            {t('moderation.ongletEnAttente')}
          </button>
          <button
            type="button"
            className={`btn btn-ghost${tab === 'signalees' ? ' btn-mode-active' : ''}`}
            onClick={() => setTab('signalees')}
          >
            {t('moderation.ongletSignalees')}
          </button>
        </div>

        <ErrorBanner>{error}</ErrorBanner>

        {questions == null && !error && <p className="menu-item-hint">{t('commun.chargement')}</p>}
        {questions != null && questions.length === 0 && (
          <p className="menu-item-hint">
            {tab === 'signalees' ? t('moderation.aucuneSignalee') : t('moderation.aucuneEnAttente')}
          </p>
        )}

        {questions != null && questions.length > 0 && tab === 'enAttente' && (
          <ul className="question-choice-list">
            {questions.map((q) => (
              <li key={q.id} className="question-choice-item">
                <span className={`badge-type badge-type--${q.type}`}>
                  {q.type === 'verite' ? t('mesQuestions.typeVerite') : t('mesQuestions.typeAction')}
                </span>
                <span className="regle-badge">{t(`niveau.label.${q.niveau}`)}</span>
                <span>{q.contenu}</span>
                <p className="menu-item-hint">
                  {q.author_pseudo ? t('moderation.proposePar', { pseudo: q.author_pseudo }) : t('moderation.proposeParInconnu')}
                </p>
                <div className="turn-secondary-actions">
                  <Button variant="dark" busy={busyId === q.id} disabled={busyId != null} onClick={() => handleApprove(q.id)}>
                    {t('moderation.approuver')}
                  </Button>
                  <Button variant="danger-ghost" disabled={busyId != null} onClick={() => handleReject(q.id)}>
                    {t('moderation.rejeter')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {questions != null && questions.length > 0 && tab === 'signalees' && (
          <ul className="question-choice-list">
            {questions.map((q) => (
              <li key={q.id} className="question-choice-item">
                <span className={`badge-type badge-type--${q.type}`}>
                  {q.type === 'verite' ? t('mesQuestions.typeVerite') : t('mesQuestions.typeAction')}
                </span>
                <span className="regle-badge">
                  {t('moderation.signalementCount', { count: q.signalement_count })}
                </span>
                <span>{q.contenu}</span>
                <ul className="menu-item-hint">
                  {q.signalements.map((s, i) => (
                    <li key={i}>
                      {s.roomCode
                        ? t('moderation.contexteSalon', { code: s.roomCode, date: formatDate(s.createdAt) })
                        : t('moderation.contexteSalonInconnu', { date: formatDate(s.createdAt) })}
                    </li>
                  ))}
                </ul>
                <div className="turn-secondary-actions">
                  <Button
                    variant="danger-ghost"
                    busy={busyId === q.id}
                    disabled={busyId != null}
                    onClick={() => handleUnpublish(q.id)}
                  >
                    {t('moderation.depublier')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default AdminModerationModal;
