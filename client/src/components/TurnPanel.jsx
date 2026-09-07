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
  onActivateJoker,
  onDeclareBluff,
  onSignalerQuestion,
}) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Suivi en local plutôt que via room.currentTurn : declareBluff ne diffuse
  // jamais rien (voir handlers.js), le seul signal de succès est l'ack de
  // cet appel — sauf juste après une reconnexion, où le snapshot renseigne
  // déjà turn.bluffDeclared pour le joueur actif spécifiquement (jamais pour
  // les autres, voir snapshot.js).
  const [bluffDeclaredLocally, setBluffDeclaredLocally] = useState(false);
  // Suivi en local, comme bluffDeclaredLocally ci-dessus : le signalement ne
  // diffuse rien non plus, seul l'ack confirme la prise en compte. Réinitialisé
  // sur un changement de contenu (pas seulement de tour) car la question
  // affichée peut changer en cours de tour (retournée, joker inversé).
  const [signaledLocally, setSignaledLocally] = useState(false);

  useEffect(() => {
    setText('');
    setBusy(false);
    setError(null);
    setBluffDeclaredLocally(Boolean(turn?.bluffDeclared));
    setSignaledLocally(false);
  }, [turn?.turnNumber, turn?.phase, turn?.contenu]);

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

  // Cas à part plutôt que via runAction : sur un tour bluff surprise, le
  // joueur ne sait jamais à l'avance que le jeu a déjà décidé pour lui (voir
  // game/turn.js declareBluff) — ce refus ne lui apprend rien qu'il devrait
  // savoir, un message d'erreur serait donc plus déroutant qu'utile. On
  // absorbe silencieusement et on masque le bouton, comme la seconde
  // activation du joker (règle F) l'est déjà côté serveur.
  const handleDeclareBluff = async () => {
    setError(null);
    setBusy(true);
    try {
      await onDeclareBluff();
      setBluffDeclaredLocally(true);
    } catch (err) {
      if (err?.code === 'BLUFF_DEJA_DECLARE') {
        setBluffDeclaredLocally(true);
      } else {
        setError(translateError(t, err));
      }
    } finally {
      setBusy(false);
    }
  };

  // Best-effort et silencieux : un aléa réseau ici ne doit jamais interrompre
  // la partie, le bouton reste simplement cliquable pour réessayer.
  const handleSignaler = async () => {
    try {
      await onSignalerQuestion();
      setSignaledLocally(true);
    } catch {
      // ignoré volontairement, voir commentaire ci-dessus
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
  // Règle F : n'importe quel joueur (actif compris) peut l'activer, tant que
  // personne ne l'a fait avant lui sur ce tour — pas réservé au joueur actif,
  // contrairement au refus et à la question retournée ci-dessus.
  const canJoker = regles?.jokerPublic && turn.phase === 'answering' && !turn.jokerConstraint && !turn.jokerInverse;
  // Indice côté client seulement (le serveur reste l'autorité) : au premier
  // tour de la partie, il n'existe encore aucun tour précédent à recycler.
  const canJokerInverse = canJoker && regles?.jokerInverse && turn.turnNumber > 1;

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
      {turn.contenu &&
        (signaledLocally ? (
          <p className="menu-item-hint">{t('partie.questionSignalee')}</p>
        ) : (
          <button type="button" className="link-btn" onClick={handleSignaler}>
            {t('partie.signalerQuestion')}
          </button>
        ))}
      {turn.returned && (
        <p className="menu-item-hint">{t('partie.questionRetourneeMessage', { pseudo: activeName })}</p>
      )}
      {turn.jokerConstraint && (
        <p className="regle-badge">{t(`regles.jokerPublic.contraintes.${turn.jokerConstraint}`)}</p>
      )}
      {turn.jokerInverse && <p className="regle-badge">{t('partie.jokerInverseMessage')}</p>}

      <ErrorBanner>{error}</ErrorBanner>

      {turn.phase === 'answering' && (
        <>
          {isActive ? (
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
          )}
          {canJoker && (
            <div className="turn-secondary-actions">
              {regles?.jokerInverse ? (
                <>
                  <button
                    type="button"
                    className="link-btn"
                    disabled={busy}
                    onClick={() => runAction(() => onActivateJoker('style'))}
                  >
                    {t('partie.activerJokerStyle')}
                  </button>
                  {canJokerInverse && (
                    <button
                      type="button"
                      className="link-btn"
                      disabled={busy}
                      onClick={() => runAction(() => onActivateJoker('questionPrecedente'))}
                    >
                      {t('partie.activerJokerInverse')}
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  className="link-btn"
                  disabled={busy}
                  onClick={() => runAction(() => onActivateJoker('style'))}
                >
                  {t('partie.activerJoker')}
                </button>
              )}
            </div>
          )}
        </>
      )}

      {turn.phase === 'voting' && <p className="menu-item-hint">{t('partie.reponseDansLeChat')}</p>}

      {turn.phase === 'voting' && isActive && regles?.bluffAssume && !bluffDeclaredLocally && (
        <div className="turn-secondary-actions">
          <button type="button" className="link-btn" disabled={busy} onClick={handleDeclareBluff}>
            {t('partie.declarerBluff')}
          </button>
        </div>
      )}

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
