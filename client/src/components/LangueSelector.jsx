import { useI18n } from '../hooks/useI18n.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { SUPPORTED_LANGUES, LANGUE_NATIVE_NAMES } from '../i18n/index.js';

function LangueSelector() {
  const { langue } = useI18n();
  const { changeLangue } = useAuth();

  return (
    <div className="langue-selector" role="group" aria-label="Langue">
      {SUPPORTED_LANGUES.map((code) => (
        <button
          key={code}
          type="button"
          className={`langue-btn${langue === code ? ' langue-btn--active' : ''}`}
          onClick={() => changeLangue(code)}
          aria-pressed={langue === code}
        >
          {LANGUE_NATIVE_NAMES[code]}
        </button>
      ))}
    </div>
  );
}

export default LangueSelector;
