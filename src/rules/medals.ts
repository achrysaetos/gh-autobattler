import type { LifetimeStats, Medal } from './types.ts';

interface MedalRule extends Medal {
  stat: keyof LifetimeStats;
  threshold: number;
}

export const MEDALS: readonly MedalRule[] = [
  { id: 'first-tour', name: 'First Tour', description: 'Served a full round.', stat: 'roundsPlayed', threshold: 1 },
  { id: 'old-guard', name: 'Old Guard', description: 'Served ten rounds.', stat: 'roundsPlayed', threshold: 10 },
  { id: 'laurel', name: 'Laurel', description: 'Fought on the winning side of a round.', stat: 'roundsWon', threshold: 1 },
  { id: 'first-blood', name: 'First Blood', description: 'Your soldiers felled an enemy.', stat: 'kills', threshold: 1 },
  { id: 'centurion', name: 'Centurion', description: 'Your soldiers felled 1,000 enemies.', stat: 'kills', threshold: 1000 },
  { id: 'standard-bearer', name: 'Standard Bearer', description: 'Took part in 25 captures.', stat: 'captures', threshold: 25 },
  { id: 'full-muster', name: 'Full Muster', description: 'Fielded 100 soldiers at once.', stat: 'peakSoldiers', threshold: 100 },
];

export function medalsFor(stats: LifetimeStats): Medal[] {
  return MEDALS.filter((m) => stats[m.stat] >= m.threshold).map(({ id, name, description }) => ({ id, name, description }));
}
