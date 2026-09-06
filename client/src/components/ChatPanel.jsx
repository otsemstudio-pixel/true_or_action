import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../hooks/useI18n.jsx';

const MAX_LENGTH = 300;

function makeClientId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function ChatPanel({ messages, myId, onSend }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [pending, setPending] = useState([]);
  const [error, setError] = useState(null);
  const listRef = useRef(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

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
        {messages.length === 0 && pending.length === 0 && (
          <p className="menu-item-hint">{t('chat.aucunMessage')}</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-message${m.playerId === myId ? ' chat-message--mine' : ''}`}>
            <span className="chat-message-author">{m.pseudo}</span>
            <span className="chat-message-text">{m.text}</span>
          </div>
        ))}
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
