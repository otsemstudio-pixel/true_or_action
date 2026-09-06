import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../hooks/useI18n.jsx';
import { useLongPress } from '../hooks/useLongPress.js';
import AnswerCard from './AnswerCard.jsx';

const MAX_LENGTH = 300;
const QUOTE_PREVIEW_LENGTH = 80;

function makeClientId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function truncate(text, length) {
  if (!text) return '';
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function scrollToMessage(id) {
  document.getElementById(`msg-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Citation cliquable : fait défiler jusqu'au message d'origine s'il est
// encore chargé (fenêtre de 200 messages en mémoire / 30 à la reconnexion).
function QuoteChip({ replyTo }) {
  if (!replyTo) return null;
  return (
    <button type="button" className="quote-chip" onClick={() => scrollToMessage(replyTo.id)}>
      <span className="quote-chip-author">{replyTo.pseudo}</span>
      <span className="quote-chip-text">{truncate(replyTo.text, QUOTE_PREVIEW_LENGTH)}</span>
    </button>
  );
}

// Message de chat ordinaire — bloc de réponse mis à part (voir AnswerCard).
// Appui long (mobile) ou survol + bouton (desktop) déclenchent la réponse.
function ChatBubble({ message, myId, onReply, t }) {
  const longPress = useLongPress(() => onReply(message));
  return (
    <div
      id={`msg-${message.id}`}
      className={`chat-message${message.playerId === myId ? ' chat-message--mine' : ''}`}
      {...longPress}
    >
      <QuoteChip replyTo={message.replyTo} />
      <div className="chat-message-row">
        <span className="chat-message-author">{message.pseudo}</span>
        <span className="chat-message-text">{message.text}</span>
      </div>
      <button
        type="button"
        className="message-reply-btn"
        onClick={() => onReply(message)}
        aria-label={t('chat.repondre')}
      >
        ↩
      </button>
    </div>
  );
}

function ChatPanel({ messages, players, myId, currentTurn, onSend, onVote }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [pending, setPending] = useState([]);
  const [error, setError] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null); // { id, pseudo, text } | null
  const listRef = useRef(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  const handleReply = (message) => {
    setReplyingTo({ id: message.id, pseudo: message.pseudo, text: message.text });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;

    const clientId = makeClientId();
    const replySnapshot = replyingTo;
    setPending((prev) => [...prev, { clientId, text: trimmed, status: 'sending', replyTo: replySnapshot }]);
    setText('');
    setReplyingTo(null);
    setError(null);

    try {
      await onSend(trimmed, clientId, replySnapshot?.id);
      setPending((prev) => prev.filter((m) => m.clientId !== clientId));
    } catch (err) {
      setPending((prev) => prev.map((m) => (m.clientId === clientId ? { ...m, status: 'failed' } : m)));
      if (err.code === 'RATE_LIMITED') {
        setError(t('chat.tropDeMessages'));
      }
    }
  };

  const retry = async (msg) => {
    setPending((prev) => prev.map((m) => (m.clientId === msg.clientId ? { ...m, status: 'sending' } : m)));
    try {
      await onSend(msg.text, msg.clientId, msg.replyTo?.id);
      setPending((prev) => prev.filter((m) => m.clientId !== msg.clientId));
    } catch {
      setPending((prev) => prev.map((m) => (m.clientId === msg.clientId ? { ...m, status: 'failed' } : m)));
    }
  };

  return (
    <div className="card chat-panel">
      <h2>{t('chat.titre')}</h2>
      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && pending.length === 0 && <p className="menu-item-hint">{t('chat.aucunMessage')}</p>}
        {messages.map((message) =>
          message.turnInfo ? (
            <AnswerCard
              key={message.id}
              message={message}
              players={players}
              myId={myId}
              currentTurn={currentTurn}
              onVote={onVote}
              onReply={handleReply}
            />
          ) : (
            <ChatBubble key={message.id} message={message} myId={myId} onReply={handleReply} t={t} />
          )
        )}
        {pending.map((m) => (
          <div key={m.clientId} className="chat-message chat-message--mine chat-message--pending">
            <QuoteChip replyTo={m.replyTo} />
            <div className="chat-message-row">
              <span className="chat-message-text">{m.text}</span>
            </div>
            {m.status === 'sending' && <span className="chat-message-status">{t('chat.envoiEnCours')}</span>}
            {m.status === 'failed' && (
              <button type="button" className="link-btn chat-message-retry" onClick={() => retry(m)}>
                {t('chat.echecReessayer')}
              </button>
            )}
          </div>
        ))}
      </div>

      {error && <p className="field-error-text">{error}</p>}

      {replyingTo && (
        <div className="reply-preview">
          <div className="reply-preview-content">
            <span className="reply-preview-author">{t('chat.reponseA', { pseudo: replyingTo.pseudo })}</span>
            <span className="reply-preview-text">{truncate(replyingTo.text, QUOTE_PREVIEW_LENGTH)}</span>
          </div>
          <button
            type="button"
            className="reply-preview-cancel"
            onClick={() => setReplyingTo(null)}
            aria-label={t('chat.annulerLaReponse')}
          >
            ×
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="chat-form">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_LENGTH))}
          placeholder={t('chat.ecrireUnMessage')}
          maxLength={MAX_LENGTH}
          aria-label={t('chat.messageLabel')}
        />
        <button type="submit" className="btn btn-secondary chat-send-btn" disabled={!text.trim()}>
          {t('commun.envoyer')}
        </button>
      </form>
    </div>
  );
}

export default ChatPanel;
