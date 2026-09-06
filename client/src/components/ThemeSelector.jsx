import { useTheme } from '../hooks/useTheme.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { useI18n } from '../hooks/useI18n.jsx';

const THEMES = [
  { code: 'light', icon: '☀️', labelKey: 'commun.themeClair' },
  { code: 'dark', icon: '🌙', labelKey: 'commun.themeSombre' },
];

function ThemeSelector() {
  const { theme } = useTheme();
  const { changeTheme } = useAuth();
  const { t } = useI18n();

  return (
    <div className="langue-selector" role="group" aria-label="Thème">
      {THEMES.map(({ code, icon, labelKey }) => (
        <button
          key={code}
          type="button"
          className={`langue-btn${theme === code ? ' langue-btn--active' : ''}`}
          onClick={() => changeTheme(code)}
          aria-pressed={theme === code}
          aria-label={t(labelKey)}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}

export default ThemeSelector;
