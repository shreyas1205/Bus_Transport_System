import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import {
  clearAuthSession,
  readAuthToken,
  readAuthUser,
  saveAuthSession
} from './authStorage';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => readAuthUser());
  const [loading, setLoading] = useState(() => Boolean(readAuthToken()));

  useEffect(() => {
    if (!readAuthToken()) {
      setLoading(false);
      return;
    }

    let mounted = true;
    api.get('/auth/me')
      .then((response) => {
        if (mounted) setUser(response.data);
      })
      .catch(() => {
        if (mounted) logout();
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => { mounted = false; };
  }, []);

  function logout() {
    clearAuthSession();
    setUser(null);
  }

  async function login(email, password, remember = false) {
    const response = await api.post('/auth/login', {
      email,
      password,
      rememberMe: remember === true
    });
    saveAuthSession({
      token: response.data.token,
      user: response.data.user,
      remember
    });
    setUser(response.data.user);
    return response.data.user;
  }

  const value = useMemo(
    () => ({ user, loading, login, logout }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
