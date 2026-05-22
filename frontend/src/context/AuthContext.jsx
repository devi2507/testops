import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sessionActive = localStorage.getItem('testops_session_active');
    if (sessionActive === 'true') {
      const stored = localStorage.getItem('testops_user');
      if (stored) {
        try { setUser(JSON.parse(stored)); } catch { localStorage.removeItem('testops_user'); }
      }
    }
    setLoading(false);
  }, []);

  const login = (userData) => {
    setUser(userData);
    localStorage.setItem('testops_user', JSON.stringify(userData));
    localStorage.setItem('testops_session_active', 'true');
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('testops_session_active');
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
