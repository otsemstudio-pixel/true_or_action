import { createContext, useContext, useState, useCallback, useMemo } from 'react';

const THEME_KEY = 'tord_theme';
const SUPPORTED_THEMES = ['light', 'dark'];
const ThemeContext = createContext(null);

// Le thème initial est déjà posé sur <html> par le script inline d'index.html
// (avant tout rendu, pour éviter un flash) : on se contente de lire ce que le
// DOM porte déjà plutôt que de refaire la détection ici.
function initialTheme() {
  const attr = document.documentElement.getAttribute('data-theme');
  return SUPPORTED_THEMES.includes(attr) ? attr : 'dark';
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(initialTheme);

  const setTheme = useCallback((next) => {
    if (!SUPPORTED_THEMES.includes(next)) return;
    setThemeState(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // pas grave si la persistance locale échoue, la session en cours reste correcte
    }
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme doit être utilisé à l'intérieur de ThemeProvider");
  }
  return ctx;
}
