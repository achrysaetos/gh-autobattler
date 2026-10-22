import type { ObjectiveDef } from '../sim/api.ts';

const STRONGHOLD_NAMES = [
  'Ashford Keep',
  'Greywater Tower',
  'Hollin Watch',
  'Brackmoor',
  'Ravensreach',
  'Thornwall',
  'Elderholt',
  'Saltmarch Spire',
  'Copperfell',
  'Wyrmgate',
  'Duskhollow',
  'Ironmere',
  'Kestrel Rock',
  'Fennick Hold',
  'Morrow Bastion',
  'Lantern Cairn',
];

export function objectiveName(def: ObjectiveDef, factionName?: string): string {
  if (def.kind === 'citadel') return 'The Citadel';
  if (def.kind === 'base') return factionName ? `${factionName} Camp` : 'War Camp';
  return STRONGHOLD_NAMES[def.id % STRONGHOLD_NAMES.length]!;
}

const RANK_TITLES = ['Recruit', 'Corporal', 'Sergeant', 'Captain', 'Marshal'] as const;

export function rankTitle(rank: number): string {
  return RANK_TITLES[Math.max(0, Math.min(4, rank))]!;
}

