import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import {
  register as apiRegister,
  login as apiLogin,
  fetchMe,
  updateLangue as apiUpdateLangue,
  updateTheme as apiUpdateTheme,
  playAsGuest as apiPlayAsGuest,
  resumeGuest as apiResumeGuest,
  convertGuest as apiConvertGuest,
  fetchMyQuestions as apiFetchMyQuestions,
  proposeQuestion as apiProposeQuestion,
  updateQuestion as apiUpdateQuestion,
  withdrawQuestion as apiWithdrawQuestion,
  fetchPendingQuestions as apiFetchPendingQuestions,
  approvePendingQuestion as apiApprovePendingQuestion,
  rejectPendingQuestion as apiRejectPendingQuestion,
  fetchReportedQuestions as apiFetchReportedQuestions,
  unpublishQuestion as apiUnpublishQuestion,
} from '../lib/api.js';
import { connectSocket, disconnectSocket } from '../lib/socket.js';
import { useI18n } from './useI18n.jsx';
import { useTheme } from './useTheme.jsx';

const TOKEN_KEY = 'tord_token';
// Un invité n'a ni email ni mot de passe : ce jeton (permanent, contrairement
// au JWT qui expire à 30 jours) est son seul moyen de retrouver son identité
// si le JWT stocké a expiré — voir /api/auth/guest/resume.
const GUEST_TOKEN_KEY = 'tord_guest_token';
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const { langue, setLangue } = useI18n();
  const { theme, setTheme } = useTheme();
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | authenticated | anonymous
  const tokenRef = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    const guestToken = localStorage.getItem(GUEST_TOKEN_KEY);

    // Le JWT stocké (jusqu'à 30 jours) suffit dans l'immense majorité des
    // cas. S'il a expiré ou n'existe pas mais qu'un jeton invité est
    // disponible, on l'échange contre un JWT frais — un invité n'a ni email
    // ni mot de passe pour se reconnecter autrement.
    const resumeFromGuestToken = () => {
      if (!guestToken) {
        setStatus('anonymous');
        return;
      }
      apiResumeGuest(guestToken)
        .then((result) => applySession(result, { guestToken }))
        .catch(() => {
          localStorage.removeItem(GUEST_TOKEN_KEY);
          setStatus('anonymous');
        });
    };

    if (!token) {
      resumeFromGuestToken();
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
        resumeFromGuestToken();
      });
    // Ne dépend volontairement que du montage initial : setLangue/setTheme sont
    // stables (useCallback) et on ne veut pas relire /me à chaque changement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applySession = useCallback(
    ({ token, user }, { guestToken } = {}) => {
      localStorage.setItem(TOKEN_KEY, token);
      if (guestToken) localStorage.setItem(GUEST_TOKEN_KEY, guestToken);
      // Une conversion en compte complet efface le jeton invité : le serveur
      // l'a déjà mis à NULL en base, il ne doit plus servir côté client non plus.
      if (user.isGuest === false) localStorage.removeItem(GUEST_TOKEN_KEY);
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

  // Un seul champ (le pseudo) : pas d'email ni de mot de passe à saisir pour
  // jouer. `result.guestToken` est le jeton permanent à conserver pour
  // retrouver ce compte plus tard (voir la vérification au montage ci-dessus).
  const playAsGuest = useCallback(
    async (pseudo) => {
      const result = await apiPlayAsGuest({ pseudo, langue, theme });
      applySession(result, { guestToken: result.guestToken });
      return result;
    },
    [applySession, langue, theme]
  );

  // Conversion d'un invité en compte complet : tout est conservé côté
  // serveur (pseudo, historique, questions, packs, même id) — seul le moyen
  // de s'authentifier change.
  const convertToFullAccount = useCallback(
    async (payload) => {
      if (!tokenRef.current) {
        throw Object.assign(new Error('Non connecté'), { code: 'UNAUTHORIZED' });
      }
      const result = await apiConvertGuest(tokenRef.current, payload);
      applySession(result);
      return result;
    },
    [applySession]
  );

  // "Gérer mes questions" : mêmes garde-fous que convertToFullAccount
  // (jeton requis), le serveur applique en plus ses propres règles
  // (compte complet, propriété, statut en_attente pour modifier/retirer).
  const fetchMyQuestions = useCallback(() => {
    if (!tokenRef.current) {
      throw Object.assign(new Error('Non connecté'), { code: 'UNAUTHORIZED' });
    }
    return apiFetchMyQuestions(tokenRef.current);
  }, []);

  const proposeQuestion = useCallback((payload) => {
    if (!tokenRef.current) {
      throw Object.assign(new Error('Non connecté'), { code: 'UNAUTHORIZED' });
    }
    return apiProposeQuestion(tokenRef.current, payload);
  }, []);

  const updateQuestion = useCallback((id, payload) => {
    if (!tokenRef.current) {
      throw Object.assign(new Error('Non connecté'), { code: 'UNAUTHORIZED' });
    }
    return apiUpdateQuestion(tokenRef.current, id, payload);
  }, []);

  const withdrawQuestion = useCallback((id) => {
    if (!tokenRef.current) {
      throw Object.assign(new Error('Non connecté'), { code: 'UNAUTHORIZED' });
    }
    return apiWithdrawQuestion(tokenRef.current, id);
  }, []);

  // Modération (admin) : mêmes garde-fous, le serveur revérifie de toute
  // façon users.is_admin en base à chaque appel (voir requireAdmin) — ceci
  // ne fait que refuser tôt si aucune session n'est active.
  const fetchPendingQuestions = useCallback(() => {
    if (!tokenRef.current) {
      throw Object.assign(new Error('Non connecté'), { code: 'UNAUTHORIZED' });
    }
    return apiFetchPendingQuestions(tokenRef.current);
  }, []);

  const approvePendingQuestion = useCallback((id) => {
    if (!tokenRef.current) {
      throw Object.assign(new Error('Non connecté'), { code: 'UNAUTHORIZED' });
    }
    return apiApprovePendingQuestion(tokenRef.current, id);
  }, []);

  const rejectPendingQuestion = useCallback((id) => {
    if (!tokenRef.current) {
      throw Object.assign(new Error('Non connecté'), { code: 'UNAUTHORIZED' });
    }
    return apiRejectPendingQuestion(tokenRef.current, id);
  }, []);

  const fetchReportedQuestions = useCallback(() => {
    if (!tokenRef.current) {
      throw Object.assign(new Error('Non connecté'), { code: 'UNAUTHORIZED' });
    }
    return apiFetchReportedQuestions(tokenRef.current);
  }, []);

  const unpublishQuestion = useCallback((id) => {
    if (!tokenRef.current) {
      throw Object.assign(new Error('Non connecté'), { code: 'UNAUTHORIZED' });
    }
    return apiUnpublishQuestion(tokenRef.current, id);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(GUEST_TOKEN_KEY);
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
    <AuthContext.Provider
      value={{
        user,
        status,
        register,
        login,
        playAsGuest,
        convertToFullAccount,
        logout,
        changeLangue,
        changeTheme,
        fetchMyQuestions,
        proposeQuestion,
        updateQuestion,
        withdrawQuestion,
        fetchPendingQuestions,
        approvePendingQuestion,
        rejectPendingQuestion,
        fetchReportedQuestions,
        unpublishQuestion,
      }}
    >
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
