'use client';
import { createContext, useContext } from 'react';

/**
 * NavContext — lets the global assistant widget drive app navigation.
 * page.tsx owns the `view` state (and a `pendingRoom`); CommandCenter consumes
 * `pendingRoom` to switch its internal room. `allowed` is the set of view ids
 * the current role may open, so navigation can't jump out of role scope.
 */
export interface NavApi {
  goTo: (view: string, room?: string) => boolean; // returns false if not allowed for the role
  pendingRoom: string | null;
  consumePendingRoom: () => void;
  allowed: Set<string>;
}

const NavContext = createContext<NavApi | null>(null);

export function NavProvider({ value, children }: { value: NavApi; children: React.ReactNode }) {
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): NavApi | null {
  return useContext(NavContext);
}
