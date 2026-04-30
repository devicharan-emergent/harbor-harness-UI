import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { setCreatedBy } from '@/services/apiHelpers';

const AuthContext = createContext(null);

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const TOKEN_KEY = 'acm_session_token';

// Shared axios instance. We authenticate by appending ?access_token=<token>
// on every request rather than Authorization header, because the Emergent
// preview infra 307-redirects api.* -> internal.api.* across origins, and
// browsers strip the Authorization header on cross-origin redirects. A query
// param survives the redirect cleanly.
export const authAxios = axios.create({ baseURL: API });

function getStoredToken() {
  try { return window.localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
}
function setStoredToken(token) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
}

// Attach access_token as a query param on every authAxios request.
authAxios.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) {
    config.params = { ...(config.params || {}), access_token: token };
  }
  return config;
});

export function AuthProvider({ children }) {
  const [user, setUserState] = useState(null);
  // null = checking, true/false = resolved
  const [loading, setLoading] = useState(true);

  // Wrap setUser so every state change mirrors into the ownership helper.
  const setUser = useCallback((next) => {
    setUserState(next);
    setCreatedBy(next?.user_id || null);
  }, []);

  const checkAuth = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const { data } = await authAxios.get('/auth/me');
      setUser(data);
    } catch {
      setStoredToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [setUser]);

  useEffect(() => {
    // Emergent OAuth returns to `${origin}/` with `#session_id=<token>` in the
    // URL hash. Exchange it BEFORE any gated route decides to redirect.
    const hashMatch = (window.location.hash || '').match(/session_id=([^&]+)/);
    if (hashMatch) {
      const sid = hashMatch[1];
      (async () => {
        try {
          const { data } = await authAxios.post('/auth/session', { session_id: sid });
          if (data?.session_token) setStoredToken(data.session_token);
          setUser(data);
        } catch {
          setUser(null);
        } finally {
          window.history.replaceState({}, '', window.location.pathname + window.location.search);
          setLoading(false);
        }
      })();
      return;
    }
    checkAuth();
  }, [checkAuth, setUser]);

  const logout = useCallback(async () => {
    try { await authAxios.post('/auth/logout'); } catch { /* ignore */ }
    setStoredToken(null);
    setUser(null);
    window.location.href = '/login';
  }, [setUser]);

  return (
    <AuthContext.Provider value={{ user, loading, logout, refresh: checkAuth, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

// Convenience: stable UUID threaded through all harness CRUD as created_by.
// We use the internal user_id (UUID) — never email, which can change.
export function useCreatedBy() {
  const { user } = useAuth();
  return user?.user_id || null;
}
