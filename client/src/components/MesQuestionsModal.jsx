import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { useI18n } from '../hooks/useI18n.jsx';
import { translateError } from '../i18n/index.js';
import { NIVEAUX } from '../lib/niveau.js';
import Button from './Button.jsx';
import ErrorBanner from './ErrorBanner.jsx';

const STATUT_LABEL_KEY = {
  en_attente: 'mesQuestions.statutEnAttente',
  public: 'mesQuestions.statutPublique',
  rejete: 'mesQuestions.statutRejetee',
};

function emptyForm() {
  return { type: 'verite', niveau: 1, contenu: '' };
}

// Modale ouverte depuis le bouton "Gérer mes questions" du menu (voir
// MenuScreen.jsx) : liste les questions proposées par le compte, avec
// proposition d'une nouvelle et modification/retrait tant que la modération
// n'a pas encore tranché (moderation = 'en_attente', vérifié côté serveur —
// voir routes/questions.js). Un changement de statut fait par un admin est
// visible ici à la prochaine ouverture, sans plomberie supplémentaire :
// c'est la même ligne en base, seul le filtre d'affichage change.
function MesQuestionsModal({ open, onClose }) {
  const { fetchMyQuestions, proposeQuestion, updateQuestion, withdrawQuestion } = useAuth();
  const { t } = useI18n();
  const [questions, setQuestions] = useState(null);
  const [listError, setListError] = useState(null);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState(null);
  const [formBusy, setFormBusy] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [editError, setEditError] = useState(null);
  const [editBusy, setEditBusy] = useState(false);
  const [withdrawingId, setWithdrawingId] = useState(null);

  const load = () => {
    setListError(null);
    fetchMyQuestions()
      .then(({ questions }) => setQuestions(questions))
      .catch((err) => setListError(translateError(t, err)));
  };

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const handlePropose = async (e) => {
    e.preventDefault();
    setFormError(null);
    setFormBusy(true);
    try {
      await proposeQuestion(form);
      setForm(emptyForm());
      setFormOpen(false);
      load();
    } catch (err) {
      setFormError(translateError(t, err));
    } finally {
      setFormBusy(false);
    }
  };

  const startEdit = (question) => {
    setEditingId(question.id);
    setEditForm({ type: question.type, niveau: question.niveau, contenu: question.contenu });
    setEditError(null);
  };

  const handleEditSave = async (e, id) => {
    e.preventDefault();
    setEditError(null);
    setEditBusy(true);
    try {
      await updateQuestion(id, editForm);
      setEditingId(null);
      load();
    } catch (err) {
      setEditError(translateError(t, err));
    } finally {
      setEditBusy(false);
    }
  };

  const handleWithdraw = async (id) => {
    if (!window.confirm(t('mesQuestions.confirmerRetrait'))) return;
    setWithdrawingId(id);
    setListError(null);
    try {
      await withdrawQuestion(id);
      load();
    } catch (err) {
      setListError(translateError(t, err));
    } finally {
      setWithdrawingId(null);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={t('mesQuestions.titre')}>
      <div className="modal-panel card">
        <div className="modal-header">
          <h2>{t('mesQuestions.titre')}</h2>
          <button type="button" className="link-btn" onClick={onClose}>
            {t('commun.fermer')}
          </button>
        </div>

        <ErrorBanner>{listError}</ErrorBanner>

        {!formOpen && (
          <Button variant="ghost" block onClick={() => setFormOpen(true)}>
            {t('mesQuestions.proposerUneQuestion')}
          </Button>
        )}

        {formOpen && (
          <form onSubmit={handlePropose} className="turn-answer-form">
            <div className="settings-mode">
              <button
                type="button"
                className={`btn btn-ghost${form.type === 'verite' ? ' btn-mode-active' : ''}`}
                onClick={() => setForm((f) => ({ ...f, type: 'verite' }))}
              >
                {t('mesQuestions.typeVerite')}
              </button>
              <button
                type="button"
                className={`btn btn-ghost${form.type === 'action' ? ' btn-mode-active' : ''}`}
                onClick={() => setForm((f) => ({ ...f, type: 'action' }))}
              >
                {t('mesQuestions.typeAction')}
              </button>
            </div>
            <div className="settings-mode settings-mode--niveau">
              {NIVEAUX.map((niveau) => (
                <button
                  key={niveau}
                  type="button"
                  className={`btn btn-ghost${form.niveau === niveau ? ' btn-mode-active' : ''}`}
                  onClick={() => setForm((f) => ({ ...f, niveau }))}
                >
                  {t(`niveau.label.${niveau}`)}
                </button>
              ))}
            </div>
            <div className="field">
              <label htmlFor="propose-contenu">{t('mesQuestions.texteDeLaQuestion')}</label>
              <textarea
                id="propose-contenu"
                rows={3}
                value={form.contenu}
                onChange={(e) => setForm((f) => ({ ...f, contenu: e.target.value }))}
              />
            </div>
            <ErrorBanner>{formError}</ErrorBanner>
            <div className="vote-buttons">
              <Button type="submit" variant="dark" busy={formBusy} disabled={!form.contenu.trim()}>
                {t('mesQuestions.proposer')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={formBusy}
                onClick={() => {
                  setFormOpen(false);
                  setForm(emptyForm());
                  setFormError(null);
                }}
              >
                {t('mesQuestions.annuler')}
              </Button>
            </div>
          </form>
        )}

        {questions == null && !listError && <p className="menu-item-hint">{t('commun.chargement')}</p>}
        {questions != null && questions.length === 0 && (
          <p className="menu-item-hint">{t('mesQuestions.aucuneQuestion')}</p>
        )}

        {questions != null && questions.length > 0 && (
          <ul className="question-choice-list">
            {questions.map((q) =>
              editingId === q.id ? (
                <li key={q.id} className="question-choice-item">
                  <form onSubmit={(e) => handleEditSave(e, q.id)} className="turn-answer-form">
                    <div className="settings-mode">
                      <button
                        type="button"
                        className={`btn btn-ghost${editForm.type === 'verite' ? ' btn-mode-active' : ''}`}
                        onClick={() => setEditForm((f) => ({ ...f, type: 'verite' }))}
                      >
                        {t('mesQuestions.typeVerite')}
                      </button>
                      <button
                        type="button"
                        className={`btn btn-ghost${editForm.type === 'action' ? ' btn-mode-active' : ''}`}
                        onClick={() => setEditForm((f) => ({ ...f, type: 'action' }))}
                      >
                        {t('mesQuestions.typeAction')}
                      </button>
                    </div>
                    <div className="settings-mode settings-mode--niveau">
                      {NIVEAUX.map((niveau) => (
                        <button
                          key={niveau}
                          type="button"
                          className={`btn btn-ghost${editForm.niveau === niveau ? ' btn-mode-active' : ''}`}
                          onClick={() => setEditForm((f) => ({ ...f, niveau }))}
                        >
                          {t(`niveau.label.${niveau}`)}
                        </button>
                      ))}
                    </div>
                    <textarea
                      rows={3}
                      value={editForm.contenu}
                      onChange={(e) => setEditForm((f) => ({ ...f, contenu: e.target.value }))}
                    />
                    <ErrorBanner>{editError}</ErrorBanner>
                    <div className="vote-buttons">
                      <Button type="submit" variant="dark" busy={editBusy} disabled={!editForm.contenu.trim()}>
                        {t('mesQuestions.enregistrer')}
                      </Button>
                      <Button type="button" variant="ghost" disabled={editBusy} onClick={() => setEditingId(null)}>
                        {t('mesQuestions.annuler')}
                      </Button>
                    </div>
                  </form>
                </li>
              ) : (
                <li key={q.id} className="question-choice-item">
                  <span className={`badge-type badge-type--${q.type}`}>
                    {q.type === 'verite' ? t('mesQuestions.typeVerite') : t('mesQuestions.typeAction')}
                  </span>
                  <span className="regle-badge">{t(STATUT_LABEL_KEY[q.moderation] ?? q.moderation)}</span>
                  <span>{q.contenu}</span>
                  {q.moderation === 'en_attente' && (
                    <div className="turn-secondary-actions">
                      <button type="button" className="link-btn" onClick={() => startEdit(q)}>
                        {t('mesQuestions.modifier')}
                      </button>
                      <button
                        type="button"
                        className="link-btn"
                        disabled={withdrawingId === q.id}
                        onClick={() => handleWithdraw(q.id)}
                      >
                        {t('mesQuestions.retirer')}
                      </button>
                    </div>
                  )}
                </li>
              )
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

export default MesQuestionsModal;
