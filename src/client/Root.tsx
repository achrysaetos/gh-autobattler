import { useEffect, useState, useSyncExternalStore } from 'react';
import { App } from './hud/App.tsx';
import { LostPage } from './hud/Lost.tsx';
import { Home } from './home/Home.tsx';
import type { Api } from './net/api.ts';
import { LockstepRunner } from './net/runner.ts';
import type { Connect } from './net/transport.ts';
import { parseRoute, pathFor, type BattleRoute } from './route.ts';
import { Store } from './store.ts';

export type Streams = (route: BattleRoute) => Connect;

const subscribePath = (fn: () => void) => {
  window.addEventListener('popstate', fn);
  return () => window.removeEventListener('popstate', fn);
};

const TITLES = { home: 'Pushfront · Pick your fighters', campaign: 'Pushfront · The campaign', room: 'Pushfront · Skirmish', lost: 'Pushfront · Off the map' } as const;

export function Root({ api, streams, mock }: { api: Api; streams: Streams; mock: boolean }) {
  const pathname = useSyncExternalStore(subscribePath, () => location.pathname);
  const route = parseRoute(pathname);
  useEffect(() => {
    document.title = TITLES[route.kind];
    window.scrollTo(0, 0);
  }, [route.kind, pathname]);
  switch (route.kind) {
    case 'home':
      return <Home api={api} />;
    case 'lost':
      return <LostPage />;
    case 'campaign':
    case 'room':
      return <Battle key={pathFor(route)} route={route} connect={streams(route)} api={api} mock={mock} />;
  }
}

function Battle({ route, connect, api, mock }: { route: BattleRoute; connect: Connect; api: Api; mock: boolean }) {
  const [pair] = useState(() => {
    const store = new Store();
    return { store, runner: new LockstepRunner(connect, store) };
  });
  useEffect(() => {
    pair.runner.start();
    if (mock) Object.assign(window, { pushfront: { store: pair.store, runner: pair.runner } });
    return () => {
      pair.runner.stop();
      pair.store.dispose();
    };
  }, [pair, mock]);
  return <App store={pair.store} runner={pair.runner} api={api} mock={mock} room={route.kind === 'room' ? route.slug : null} />;
}
