export type Route = { kind: 'home' } | { kind: 'campaign' } | { kind: 'room'; slug: string } | { kind: 'lost'; path: string };

export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return { kind: 'home' };
  if (path === '/campaign') return { kind: 'campaign' };
  const slug = /^\/r\/([A-Za-z0-9_-]{1,64})$/.exec(path)?.[1];
  if (slug) return { kind: 'room', slug };
  return { kind: 'lost', path: pathname };
}

export function pathFor(route: Route): string {
  switch (route.kind) {
    case 'home':
      return '/';
    case 'campaign':
      return '/campaign';
    case 'room':
      return `/r/${encodeURIComponent(route.slug)}`;
    case 'lost':
      return route.path;
  }
}

export type BattleRoute = Extract<Route, { kind: 'campaign' | 'room' }>;

export function streamPathFor(route: BattleRoute): string {
  return route.kind === 'room' ? `/ws?room=${encodeURIComponent(route.slug)}` : '/ws';
}

export function hrefFor(route: Route): string {
  const path = pathFor(route);
  return new URLSearchParams(location.search).has('mock') ? `${path}?mock` : path;
}

export function navigate(route: Route): void {
  const href = hrefFor(route);
  if (href === location.pathname + location.search) return;
  history.pushState(null, '', href);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
