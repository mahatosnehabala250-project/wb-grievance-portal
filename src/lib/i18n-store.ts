import { create } from 'zustand';
import type { Lang } from './i18n';
import { t as translate } from './i18n';

interface I18nState {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string) => string;
}

const stored = (typeof window !== 'undefined' ? localStorage.getItem('wb_language') : null) as Lang | null;

export const useI18nStore = create<I18nState>((set, get) => ({
  lang: stored === 'bn' ? 'bn' : 'en',
  setLang: (lang: Lang) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('wb_language', lang);
    }
    set({ lang });
  },
  t: (key: string) => translate(key, get().lang),
}));
