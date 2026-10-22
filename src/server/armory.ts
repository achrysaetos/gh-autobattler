import { computeArmy } from '../rules/army.ts';
import { dominantLanguage } from '../rules/factions.ts';
import type { Army, IsoDay } from '../rules/types.ts';
import type { Store } from './db.ts';

export interface Muscle {
  army: Army;
  language: string | null;
}

export class Armory {
  private cache = new Map<number, Muscle & { today: IsoDay }>();

  constructor(private readonly store: Store) {}

  get(playerId: number, today: IsoDay): Muscle {
    const hit = this.cache.get(playerId);
    if (hit && hit.today === today) return hit;
    return this.refresh(playerId, today);
  }

  refresh(playerId: number, today: IsoDay): Muscle {
    const contributions = this.store.contributions(playerId);
    const entry = { army: computeArmy(contributions, today), language: dominantLanguage(contributions, today), today };
    this.cache.set(playerId, entry);
    return entry;
  }
}
