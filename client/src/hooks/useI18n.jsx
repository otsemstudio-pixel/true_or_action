import { createContext, useContext, useMemo, useState, useCallback } from 'react';
import { DICTIONARIES, DEFAULT_LANGUE, detectLangueFromNavigator, createTranslator } from '../i18n/index.js';

const LANGUE_KEY = 'tord_langue';
const I18nContext = createContext(null);

function initialLangue() {
  try {
    const stored = localStorage.getItem(LANGUE_KEY);
    if (stored && DICTIONARIES[stored]) return stored;
  } catch {
    // localStorage indisponible (navigation privée, etc.) : on retombe sur la détection.
  }
  return detectLangueFromNavigator();
}

export function I18nProvider({ children }) {
  const [langue, setLangueState] = useState(initialLangue);

  const setLangue = useCallback((next) => {
    if (!DICTIONARIES[next]) return;
    setLangueState(next);
    try {
      localStorage.setItem(LANGUE_KEY, next);
    } catch {
      // pas grave si la persistance locale échoue, la session en cours reste correcte
    }
  }, []);

  const t = useMemo(() => createTranslator(DICTIONARIES[langue] ?? DICTIONARIES[DEFAULT_LANGUE]), [langue]);

  const value = useMemo(() => ({ langue, setLangue, t }), [langue, setLangue, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n doit être utilisé à l'intérieur de I18nProvider");
  }
  return ctx;
}
