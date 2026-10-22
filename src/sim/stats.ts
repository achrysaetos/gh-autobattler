import { UnitKind } from './api.ts';

export interface UnitStats {
  hp: number;
  damage: number;
  range: number;
  speed: number;
  cooldown: number;
  aggro: number;
  ranged: boolean;
  strength: number;
}

export const STATS: readonly UnitStats[] = [
  { hp: 120, damage: 12, range: 13, speed: 1.4, cooldown: 10, aggro: 110, ranged: false, strength: 1 },
  { hp: 70, damage: 9, range: 100, speed: 1.8, cooldown: 14, aggro: 135, ranged: true, strength: 1.3 },
  { hp: 100, damage: 15, range: 13, speed: 2.9, cooldown: 12, aggro: 150, ranged: false, strength: 1.2 },
];

export const BEATS: readonly UnitKind[] = [UnitKind.Cavalry, UnitKind.Infantry, UnitKind.Archer];
export const FAVORED_MULTIPLIER = 1.5;
export const RANK_BONUS = 0.08;
export const FOREST_SPEED = 0.6;
export const FOREST_ARROW_FACTOR = 0.5;

export const MAX_ALIVE = 2400;
export const RESPAWN_TICKS = 200;
export const DOMINATION_TICKS = 216000;
export const COUNCIL_PERIOD = 30;

export function rankFactor(rank: number): number {
  return 1 + RANK_BONUS * rank;
}

export function hitDamage(kind: UnitKind, rank: number, targetKind: UnitKind, targetInForest: boolean): number {
  const s = STATS[kind]!;
  let dmg = s.damage * rankFactor(rank);
  if (BEATS[kind] === targetKind) dmg *= FAVORED_MULTIPLIER;
  if (s.ranged && targetInForest) dmg *= FOREST_ARROW_FACTOR;
  return dmg;
}
