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

function safeLSGet(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem(key); } catch { return null; }
}

function safeLSSet(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key, value); } catch { /* noop */ }
}

function safeLSRemove(key: string): void {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem(key); } catch { /* noop */ }
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
      safeLSSet('wb_token', data.token);
      safeLSSet('wb_user', JSON.stringify(data.user));

      return true;
    } catch {
      set({ error: 'Network error. Please try again.', isLoading: false });
      return false;
    }
  },

  logout: () => {
    fetch('/api/auth/me', { method: 'POST' }).catch(() => {});
    set({ user: null, token: null, error: null, isAuthenticated: false });
    safeLSRemove('wb_token');
    safeLSRemove('wb_user');
  },

  checkAuth: async () => {
    // Try to restore from localStorage first
    const savedToken = safeLSGet('wb_token');
    const savedUser = safeLSGet('wb_user');

    if (savedToken && savedUser) {
      try {
        set({ token: savedToken, user: JSON.parse(savedUser), isAuthenticated: true });
      } catch {
        // Invalid JSON, continue with server check
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
        safeLSRemove('wb_token');
        safeLSRemove('wb_user');
      }
    } catch {
      set({ isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
