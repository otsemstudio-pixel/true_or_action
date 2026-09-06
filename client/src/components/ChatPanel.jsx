import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../hooks/useI18n.jsx';
import AnswerCard from './AnswerCard.jsx';

const MAX_LENGTH = 300;

function makeClientId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Fusionne les messages libres et les blocs de réponse dans un seul fil,
// triés par horodatage : les réponses ne défilent plus sans laisser de trace,
// elles vivent au même endroit que la discussion.
function buildFeed(messages, answerCards) {
  const items = [
    ...messages.map((m) => ({ kind: 'message', key: `m-${m.id}`, createdAt: m.createdAt, data: m })),
    ...answerCards.map((c) => ({ kind: 'answer', key: `a-${c.turnNumber}`, createdAt: c.createdAt, data: c })),
  ];
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

function ChatPanel({ messages, answerCards, players, myId, currentTurn, onSend, onVote }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [pending, setPending] = useState([]);
  const [error, setError] = useState(null);
  const listRef = useRef(null);

  const feed = useMemo(() => buildFeed(messages, answerCards), [messages, answerCards]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed, pending]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;

    const clientId = makeClientId();
    setPending((prev) => [...prev, { clientId, text: trimmed, status: 'sending' }]);
    setText('');
    setError(null);

    try {
      await onSend(trimmed, clientId);
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
      await onSend(msg.text, msg.clientId);
      setPending((prev) => prev.filter((m) => m.clientId !== msg.clientId));
    } catch {
      setPending((prev) => prev.map((m) => (m.clientId === msg.clientId ? { ...m, status: 'failed' } : m)));
    }
  };

  return (
    <div className="card chat-panel">
      <h2>{t('chat.titre')}</h2>
      <div className="chat-list" ref={listRef}>
        {feed.length === 0 && pending.length === 0 && <p className="menu-item-hint">{t('chat.aucunMessage')}</p>}
        {feed.map((item) =>
          item.kind === 'message' ? (
            <div
              key={item.key}
              className={`chat-message${item.data.playerId === myId ? ' chat-message--mine' : ''}`}
            >
              <span className="chat-message-author">{item.data.pseudo}</span>
              <span className="chat-message-text">{item.data.text}</span>
            </div>
          ) : (
            <AnswerCard
              key={item.key}
              card={item.data}
              players={players}
              myId={myId}
              currentTurn={currentTurn}
              onVote={onVote}
            />
          )
        )}
        {pending.map((m) => (
          <div key={m.clientId} className="chat-message chat-message--mine chat-message--pending">
            <span className="chat-message-text">{m.text}</span>
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
