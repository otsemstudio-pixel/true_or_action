import { useEffect, useState } from 'react';
import Timer from './Timer.jsx';
import Button from './Button.jsx';
import ErrorBanner from './ErrorBanner.jsx';
import { useI18n } from '../hooks/useI18n.jsx';
import { translateError } from '../i18n/index.js';

const VOTE_SECONDS = 30;
const NIVEAU_CHOICE_SECONDS = 15;
const QUESTION_CHOICE_SECONDS = 20;
const JUGEMENT_SECONDS = 20;

function playerName(players, id) {
  return players.find((p) => p.id === id)?.pseudo ?? '…';
}

// Ne gère plus que le tour "normal" (hors tour surprise, voir
// SurpriseTurnPanel) : réponse, mais aussi les pré-phases des règles B/A
// (double ou rien, choix parmi 3) et la phase de jugement du pari mutuel.
// Une fois la réponse envoyée, son contenu et le vote qui lui est attaché
// vivent dans le bloc de réponse posté dans le chat (voir AnswerCard).
function TurnPanel({
  turn,
  players,
  myId,
  regles,
  answerSec,
  onSubmitAnswer,
  onPass,
  onChooseQuestion,
  onRespondNiveauChoice,
  onReturnQuestion,
  onJudgeBet,
}) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setText('');
    setBusy(false);
    setError(null);
  }, [turn?.turnNumber, turn?.phase]);

  if (!turn) {
    return (
      <div className="turn-panel">
        <p>{t('partie.preparationDuTour')}</p>
      </div>
    );
  }

  const isActive = turn.activePlayerId === myId;
  const activeName = playerName(players, turn.activePlayerId);

  const runAction = async (action) => {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(translateError(t, err));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    runAction(() => onSubmitAnswer(text.trim()));
  };

  // ---------- Règle B : offre de double ou rien avant la révélation ----------
  if (turn.phase === 'niveau_choice') {
    return (
      <div className="turn-panel">
        <div className="turn-panel-header">
          <span className="regle-badge">{t('partie.doubleOuRienBadge')}</span>
          <Timer deadline={turn.niveauChoiceDeadline} totalSeconds={NIVEAU_CHOICE_SECONDS} />
        </div>
        <ErrorBanner>{error}</ErrorBanner>
        {isActive ? (
          <>
            <p className="turn-question">{t('partie.doubleOuRienTitre')}</p>
            <p className="menu-item-hint">{t('partie.doubleOuRienTexte')}</p>
            <div className="vote-buttons">
              <Button variant="dark" busy={busy} onClick={() => runAction(() => onRespondNiveauChoice(true))}>
                {t('partie.doubleOuRienAccepter')}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => runAction(() => onRespondNiveauChoice(false))}>
                {t('partie.doubleOuRienRefuser')}
              </Button>
            </div>
          </>
        ) : (
          <p className="menu-item-hint">{t('partie.enAttenteDoubleOuRien', { pseudo: activeName })}</p>
        )}
      </div>
    );
  }

  // ---------- Règle A : choix parmi 3 questions ----------
  if (turn.phase === 'question_choice') {
    return (
      <div className="turn-panel">
        <div className="turn-panel-header">
          <Timer deadline={turn.questionChoiceDeadline} totalSeconds={QUESTION_CHOICE_SECONDS} />
        </div>
        <ErrorBanner>{error}</ErrorBanner>
        {isActive ? (
          <>
            <p className="turn-question">{t('partie.choisirUneQuestion')}</p>
            <div className="question-choice-list">
              {turn.choices.map((choice) => (
                <button
                  key={choice.questionId}
                  type="button"
                  className="question-choice-item"
                  disabled={busy}
                  onClick={() => runAction(() => onChooseQuestion(choice.questionId))}
                >
                  <span className={`badge-type badge-type--${choice.type}`}>
                    {choice.type === 'verite' ? t('partie.verite') : t('partie.action')}
                  </span>
                  <span>{choice.contenu}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="menu-item-hint">{t('partie.enAttenteChoixDeQuestion', { pseudo: activeName })}</p>
        )}
      </div>
    );
  }

  const canPass = regles?.refusCouteux && isActive && turn.phase === 'answering';
  const canReturn =
    regles?.questionRetournee && isActive && turn.phase === 'answering' && !turn.doubleOuRien && !turn.returned;

  return (
    <div className={`turn-panel turn-panel--${turn.type}`}>
      <div className="turn-panel-header">
        <span className={`badge-type badge-type--${turn.type}`}>
          {turn.type === 'verite' ? t('partie.verite') : t('partie.action')}
        </span>
        {turn.doubleOuRien && <span className="regle-badge">{t('partie.doubleOuRienBadge')}</span>}
        {turn.phase === 'answering' && <Timer deadline={turn.answerDeadline} totalSeconds={answerSec} />}
        {turn.phase === 'voting' && <Timer deadline={turn.voteDeadline} totalSeconds={VOTE_SECONDS} />}
        {turn.phase === 'jugement' && <Timer deadline={turn.jugementDeadline} totalSeconds={JUGEMENT_SECONDS} />}
      </div>

      <p className="turn-question">{turn.contenu ?? t('partie.questionIndisponible')}</p>
      {turn.returned && (
        <p className="menu-item-hint">{t('partie.questionRetourneeMessage', { pseudo: activeName })}</p>
      )}

      <ErrorBanner>{error}</ErrorBanner>

      {turn.phase === 'answering' &&
        (isActive ? (
          <>
            <form onSubmit={handleSubmit} className="turn-answer-form">
              <textarea
                className="answer-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t('partie.ecrisTaReponse')}
                rows={3}
                autoFocus
              />
              <Button type="submit" variant="dark" block arrow busy={busy} disabled={!text.trim()}>
                {t('commun.envoyer')}
              </Button>
            </form>
            {(canPass || canReturn) && (
              <div className="turn-secondary-actions">
                {canPass && (
                  <button type="button" className="link-btn" disabled={busy} onClick={() => runAction(onPass)}>
                    {t('partie.refuser')}
                  </button>
                )}
                {canReturn && (
                  <button type="button" className="link-btn" disabled={busy} onClick={() => runAction(onReturnQuestion)}>
                    {t('partie.retournerLaQuestion')}
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="menu-item-hint">{t('partie.estEnTrainDeRepondre', { pseudo: activeName })}</p>
        ))}

      {turn.phase === 'voting' && <p className="menu-item-hint">{t('partie.reponseDansLeChat')}</p>}

      {turn.phase === 'jugement' &&
        (isActive ? (
          <>
            <p className="menu-item-hint">
              {t('partie.pariJugerTitre', { pseudo: playerName(players, turn.pariMutuel?.bettorId) })}
            </p>
            <p className="turn-answer-reveal">{t('partie.reponseGuillemet', { reponse: turn.pariMutuel?.bet })}</p>
            <div className="vote-buttons">
              <Button variant="dark" busy={busy} onClick={() => runAction(() => onJudgeBet('juste'))}>
                {t('partie.pariVuJuste')}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => runAction(() => onJudgeBet('a_cote'))}>
                {t('partie.pariACote')}
              </Button>
            </div>
          </>
        ) : (
          <p className="menu-item-hint">{t('partie.pariEnvoye')}</p>
        ))}
    </div>
  );
}

export default TurnPanel;
