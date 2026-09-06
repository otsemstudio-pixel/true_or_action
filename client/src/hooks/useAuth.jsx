import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import {
  register as apiRegister,
  login as apiLogin,
  fetchMe,
  updateLangue as apiUpdateLangue,
  updateTheme as apiUpdateTheme,
} from '../lib/api.js';
import { connectSocket, disconnectSocket } from '../lib/socket.js';
import { useI18n } from './useI18n.jsx';
import { useTheme } from './useTheme.jsx';

const TOKEN_KEY = 'tord_token';
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const { langue, setLangue } = useI18n();
  const { theme, setTheme } = useTheme();
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | authenticated | anonymous
  const tokenRef = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setStatus('anonymous');
      return;
    }
    tokenRef.current = token;
    fetchMe(token)
      .then(({ user }) => {
        setUser(user);
        if (user.langue) setLangue(user.langue);
        if (user.theme) setTheme(user.theme);
        connectSocket(token);
        setStatus('authenticated');
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        tokenRef.current = null;
        setStatus('anonymous');
      });
    // Ne dépend volontairement que du montage initial : setLangue/setTheme sont
    // stables (useCallback) et on ne veut pas relire /me à chaque changement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applySession = useCallback(
    ({ token, user }) => {
      localStorage.setItem(TOKEN_KEY, token);
      tokenRef.current = token;
      connectSocket(token);
      setUser(user);
      if (user.langue) setLangue(user.langue);
      if (user.theme) setTheme(user.theme);
      setStatus('authenticated');
    },
    [setLangue, setTheme]
  );

  const register = useCallback(
    async (payload) => {
      const result = await apiRegister({ ...payload, langue: payload.langue ?? langue, theme: payload.theme ?? theme });
      applySession(result);
      return result;
    },
    [applySession, langue, theme]
  );

  const login = useCallback(
    async (payload) => {
      const result = await apiLogin(payload);
      applySession(result);
      return result;
    },
    [applySession]
  );

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    tokenRef.current = null;
    disconnectSocket();
    setUser(null);
    setStatus('anonymous');
  }, []);

  // Change la langue d'interface immédiatement (optimiste) et la persiste sur
  // le compte si connecté ; sinon elle ne vit que dans localStorage jusqu'à
  // l'inscription, qui l'enverra alors au serveur.
  const changeLangue = useCallback(
    (next) => {
      setLangue(next);
      if (tokenRef.current) {
        apiUpdateLangue(tokenRef.current, next).catch(() => {
          // La bascule locale reste effective même si la persistance échoue ;
          // elle sera retentée à la prochaine tentative de changement.
        });
      }
    },
    [setLangue]
  );

  // Même logique que changeLangue, pour le thème visuel.
  const changeTheme = useCallback(
    (next) => {
      setTheme(next);
      if (tokenRef.current) {
        apiUpdateTheme(tokenRef.current, next).catch(() => {
          // Idem : la bascule visuelle reste effective même si la persistance échoue.
        });
      }
    },
    [setTheme]
  );

  return (
    <AuthContext.Provider value={{ user, status, register, login, logout, changeLangue, changeTheme }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth doit être utilisé à l'intérieur de AuthProvider");
  }
  return ctx;
}
