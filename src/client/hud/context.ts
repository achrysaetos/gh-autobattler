import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { Api } from '../net/api.ts';
import type { Battlefield } from '../render/battlefield.ts';
import type { HudSnapshot, Store } from '../store.ts';

export interface HudEnv {
  store: Store;
  api: Api;
  battlefield: Battlefield | null;
  room: string | null;
  openProfile(playerId: number): void;
}

export const HudContext = createContext<HudEnv | null>(null);

export function useEnv(): HudEnv {
  const env = useContext(HudContext);
  if (!env) throw new Error('HUD rendered outside HudContext');
  return env;
}

export function useHud(): HudSnapshot {
  const { store } = useEnv();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
