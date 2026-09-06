import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { register as apiRegister, login as apiLogin, fetchMe, updateLangue as apiUpdateLangue } from '../lib/api.js';
import { connectSocket, disconnectSocket } from '../lib/socket.js';
import { useI18n } from './useI18n.jsx';

const TOKEN_KEY = 'tord_token';
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const { langue, setLangue } = useI18n();
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
        connectSocket(token);
        setStatus('authenticated');
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        tokenRef.current = null;
        setStatus('anonymous');
      });
    // Ne dépend volontairement que du montage initial : setLangue est stable
    // (useCallback) et on ne veut pas relire /me à chaque changement de langue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applySession = useCallback(
    ({ token, user }) => {
      localStorage.setItem(TOKEN_KEY, token);
      tokenRef.current = token;
      connectSocket(token);
      setUser(user);
      if (user.langue) setLangue(user.langue);
      setStatus('authenticated');
    },
    [setLangue]
  );

  const register = useCallback(
    async (payload) => {
      const result = await apiRegister({ ...payload, langue: payload.langue ?? langue });
      applySession(result);
      return result;
    },
    [applySession, langue]
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

  return (
    <AuthContext.Provider value={{ user, status, register, login, logout, changeLangue }}>
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
