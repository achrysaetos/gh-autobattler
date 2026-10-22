export type ResyncReason = 'behind' | 'desync' | 'late-input';

export type ConnState =
  | { phase: 'connecting'; attempt: number }
  | { phase: 'syncing' }
  | { phase: 'live' }
  | { phase: 'resyncing'; reason: ResyncReason }
  | { phase: 'offline'; attempt: number; retryAt: number }
  | { phase: 'refused'; reason: string };

export type ConnEvent =
  | { type: 'hello' }
  | { type: 'caught-up' }
  | { type: 'resync'; reason: ResyncReason }
  | { type: 'closed'; now: number }
  | { type: 'retry' }
  | { type: 'refused'; reason: string };

export const INITIAL_CONN: ConnState = { phase: 'connecting', attempt: 0 };

export function backoffMs(attempt: number): number {
  return Math.min(30_000, 500 * 2 ** Math.min(attempt, 6));
}

export function transition(state: ConnState, event: ConnEvent): ConnState {
  if (state.phase === 'refused') return state;
  switch (event.type) {
    case 'hello':
      return state.phase === 'connecting' || state.phase === 'resyncing' || state.phase === 'live' ? { phase: 'syncing' } : state;
    case 'caught-up':
      return state.phase === 'syncing' ? { phase: 'live' } : state;
    case 'resync':
      return state.phase === 'live' || state.phase === 'syncing' ? { phase: 'resyncing', reason: event.reason } : state;
    case 'closed': {
      if (state.phase === 'offline') return state;
      const attempt = state.phase === 'connecting' ? state.attempt + 1 : 1;
      return { phase: 'offline', attempt, retryAt: event.now + backoffMs(attempt) };
    }
    case 'retry':
      return state.phase === 'offline' ? { phase: 'connecting', attempt: state.attempt } : state;
    case 'refused':
      return { phase: 'refused', reason: event.reason };
  }
}
