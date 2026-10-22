import { soldiers } from './army.ts';
import type { Fielded } from './types.ts';

export const FIELDED_CAP = 2400;

type Kind = keyof Fielded;
const KINDS: readonly Kind[] = ['infantry', 'archers', 'cavalry'];

interface Slot {
  playerId: number;
  kind: Kind;
  have: number;
  quota: number;
  given: number;
}

// Proportional scaling with "at least 1 of any kind they have", apportioned by largest
// remainder so the total never exceeds the cap even when every share rounds up.
export function fieldArmies(armies: ReadonlyMap<number, Fielded>, cap: number = FIELDED_CAP): Map<number, Fielded> {
  const ids = [...armies.keys()].sort((a, b) => a - b);
  const total = ids.reduce((sum, id) => sum + soldiers(armies.get(id)!), 0);
  const out = new Map<number, Fielded>();
  if (total <= cap) {
    for (const id of ids) {
      const a = armies.get(id)!;
      out.set(id, { infantry: a.infantry, archers: a.archers, cavalry: a.cavalry });
    }
    return out;
  }

  const slots: Slot[] = [];
  for (const playerId of ids) {
    const a = armies.get(playerId)!;
    for (const kind of KINDS) {
      if (a[kind] <= 0) continue;
      const quota = (a[kind] * cap) / total;
      slots.push({ playerId, kind, have: a[kind], quota, given: Math.max(1, Math.floor(quota)) });
    }
  }

  let used = slots.reduce((sum, s) => sum + s.given, 0);
  if (used > cap) used = trim(slots, used - cap, used);
  const byRemainder = [...slots].sort((a, b) => b.quota - b.given - (a.quota - a.given) || order(a, b));
  for (const s of byRemainder) {
    if (used >= cap) break;
    if (s.given < s.have && s.quota > s.given) {
      s.given++;
      used++;
    }
  }

  for (const id of ids) out.set(id, { infantry: 0, archers: 0, cavalry: 0 });
  for (const s of slots) out.get(s.playerId)![s.kind] = s.given;
  return out;
}

function trim(slots: Slot[], excess: number, used: number): number {
  while (excess > 0) {
    const spare = slots.filter((s) => s.given > 1).sort((a, b) => a.quota - a.given - (b.quota - b.given) || order(a, b));
    if (spare.length === 0) break;
    for (const s of spare) {
      if (excess === 0) break;
      s.given--;
      excess--;
      used--;
    }
  }
  if (excess > 0) {
    const smallest = [...slots].sort((a, b) => a.quota - b.quota || order(b, a));
    for (const s of smallest) {
      if (excess === 0) break;
      if (s.given > 0) {
        s.given--;
        excess--;
        used--;
      }
    }
  }
  return used;
}

function order(a: Slot, b: Slot): number {
  return a.playerId - b.playerId || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind);
}
