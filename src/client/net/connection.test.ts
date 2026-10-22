import { describe, expect, it } from 'vitest';
import { INITIAL_CONN, transition, type ConnEvent, type ConnState } from './connection.ts';

function run(events: ConnEvent[], from: ConnState = INITIAL_CONN): ConnState {
  return events.reduce(transition, from);
}

describe('connection lifecycle', () => {
  it('goes live only after a hello and a full catch-up', () => {
    expect(run([{ type: 'hello' }])).toEqual({ phase: 'syncing' });
    expect(run([{ type: 'hello' }, { type: 'caught-up' }])).toEqual({ phase: 'live' });
    expect(run([{ type: 'caught-up' }])).toEqual(INITIAL_CONN);
  });

  it('resyncs on divergence and returns through syncing', () => {
    const live = run([{ type: 'hello' }, { type: 'caught-up' }]);
    const resyncing = transition(live, { type: 'resync', reason: 'desync' });
    expect(resyncing).toEqual({ phase: 'resyncing', reason: 'desync' });
    expect(transition(resyncing, { type: 'resync', reason: 'behind' })).toBe(resyncing);
    expect(run([{ type: 'hello' }, { type: 'caught-up' }], resyncing)).toEqual({ phase: 'live' });
    expect(run([{ type: 'hello' }, { type: 'resync', reason: 'desync' }])).toEqual({ phase: 'resyncing', reason: 'desync' });
  });

  it('backs off harder on each failed connect and resets after a live session', () => {
    const first = run([{ type: 'closed', now: 0 }]);
    expect(first).toEqual({ phase: 'offline', attempt: 1, retryAt: 1000 });
    const second = run([{ type: 'retry' }, { type: 'closed', now: 0 }], first);
    expect(second).toEqual({ phase: 'offline', attempt: 2, retryAt: 2000 });
    const dropped = run([{ type: 'retry' }, { type: 'hello' }, { type: 'caught-up' }, { type: 'closed', now: 0 }], second);
    expect(dropped).toEqual({ phase: 'offline', attempt: 1, retryAt: 1000 });
  });
});
