import { create } from 'zustand';

interface User {
  id: string;
  username: string;
  role: 'ADMIN' | 'BLOCK' | 'DISTRICT' | 'STATE';
  name: string;
  location: string;
  district: string | null;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  checkAuth: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isLoading: false,
  error: null,
  isAuthenticated: false,

  login: async (username: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        set({ error: data.error || 'Login failed', isLoading: false });
        return false;
      }

      set({
        user: data.user,
        token: data.token,
        isAuthenticated: true,
        isLoading: false,
      });

      // Store token in localStorage as backup
      if (typeof window !== 'undefined') {
        localStorage.setItem('wb_token', data.token);
        localStorage.setItem('wb_user', JSON.stringify(data.user));
      }

      return true;
    } catch {
      set({ error: 'Network error. Please try again.', isLoading: false });
      return false;
    }
  },

  logout: () => {
    fetch('/api/auth/me', { method: 'POST' }).catch(() => {});
    set({ user: null, token: null, error: null, isAuthenticated: false });
    if (typeof window !== 'undefined') {
      localStorage.removeItem('wb_token');
      localStorage.removeItem('wb_user');
    }
  },

  checkAuth: async () => {
    // Try to restore from localStorage first
    if (typeof window !== 'undefined') {
      const savedToken = localStorage.getItem('wb_token');
      const savedUser = localStorage.getItem('wb_user');

      if (savedToken && savedUser) {
        set({ token: savedToken, user: JSON.parse(savedUser), isAuthenticated: true });
      }
    }

    set({ isLoading: true });
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        set({ user: data.user, token: 'authenticated', isAuthenticated: true, isLoading: false });
      } else {
        set({ user: null, token: null, isAuthenticated: false, isLoading: false });
        if (typeof window !== 'undefined') {
          localStorage.removeItem('wb_token');
          localStorage.removeItem('wb_user');
        }
      }
    } catch {
      set({ isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
