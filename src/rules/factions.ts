import { inWindow } from './army.ts';
import { mulberry32 } from './prng.ts';
import type { Contribution, IsoDay } from './types.ts';

export const MAX_FACTIONS = 8;
export const AFFINITY_TOLERANCE = 0.1;

export const PALETTE: readonly number[] = [
  0xe6194b, 0x3cb44b, 0x4363d8, 0xffe119, 0xf58231, 0x911eb4, 0x42d4f4, 0xf032e6,
];

export const EPITHETS: readonly string[] = [
  'Vanguard', 'Legion', 'Covenant', 'Wardens', 'Host', 'Phalanx', 'Company', 'Order',
  'Battalion', 'Sentinels', 'Brigade', 'Compact', 'Guard', 'Banner', 'Cohort', 'Watch',
];

const NO_LANGUAGE = 'Freelance';

export interface Recruit {
  playerId: number;
  soldiers: number;
  language: string | null;
}

export interface FactionPlan {
  id: number;
  name: string;
  color: number;
  language: string | null;
  members: number[];
  soldiers: number;
}

export function factionCount(players: number): number {
  if (players <= 1) return 1;
  return Math.max(Math.min(players, 2), Math.min(MAX_FACTIONS, Math.round(Math.sqrt(players))));
}

export function dominantLanguage(contributions: readonly Contribution[], today: IsoDay): string | null {
  const weights = new Map<string, number>();
  for (const c of contributions) {
    if (c.language === null || c.count <= 0 || !inWindow(c.day, today)) continue;
    weights.set(c.language, (weights.get(c.language) ?? 0) + c.count);
  }
  return heaviest(weights);
}

export function formFactions(recruits: readonly Recruit[], count: number, seed: number): FactionPlan[] {
  const tallies = Array.from({ length: count }, () => new Map<string, number>());
  const factions: FactionPlan[] = Array.from({ length: count }, (_, id) => ({
    id,
    name: '',
    color: PALETTE[id % PALETTE.length]!,
    language: null,
    members: [],
    soldiers: 0,
  }));

  const sorted = [...recruits].sort((a, b) => b.soldiers - a.soldiers || a.playerId - b.playerId);
  for (const r of sorted) {
    const byWeakness = [...factions].sort(weaker);
    const weakest = byWeakness[0]!;
    const close = byWeakness.filter((f) => f.soldiers <= weakest.soldiers * (1 + AFFINITY_TOLERANCE));
    const kin = r.language === null ? undefined : close.find((f) => heaviest(tallies[f.id]!) === r.language);
    const chosen = kin ?? weakest;
    chosen.members.push(r.playerId);
    chosen.soldiers += r.soldiers;
    if (r.language !== null) {
      const t = tallies[chosen.id]!;
      t.set(r.language, (t.get(r.language) ?? 0) + Math.max(1, r.soldiers));
    }
  }

  const epithets = shuffledEpithets(seed);
  const languages = distinctLanguages(tallies);
  for (const f of factions) {
    f.language = languages[f.id] ?? null;
    f.name = `${f.language ?? NO_LANGUAGE} ${epithets[f.id % epithets.length]}`;
  }
  return factions;
}

export function weakestFaction(factions: readonly { id: number; soldiers: number; members: number }[]): number {
  const sorted = [...factions].sort((a, b) => a.soldiers - b.soldiers || a.members - b.members || a.id - b.id);
  const first = sorted[0];
  if (!first) throw new Error('no factions');
  return first.id;
}

function weaker(a: FactionPlan, b: FactionPlan): number {
  return a.soldiers - b.soldiers || a.members.length - b.members.length || a.id - b.id;
}

// Each language names at most one faction: the strongest claims win, and a faction outbid
// on its top language falls back to its next one.
function distinctLanguages(tallies: readonly ReadonlyMap<string, number>[]): (string | null)[] {
  const claims: { faction: number; lang: string; weight: number }[] = [];
  tallies.forEach((t, faction) => {
    for (const [lang, weight] of t) claims.push({ faction, lang, weight });
  });
  claims.sort((a, b) => b.weight - a.weight || (a.lang < b.lang ? -1 : a.lang > b.lang ? 1 : 0) || a.faction - b.faction);
  const out: (string | null)[] = tallies.map(() => null);
  const taken = new Set<string>();
  for (const c of claims) {
    if (out[c.faction] !== null || taken.has(c.lang)) continue;
    out[c.faction] = c.lang;
    taken.add(c.lang);
  }
  return out;
}

function heaviest(weights: ReadonlyMap<string, number>): string | null {
  let best: string | null = null;
  let bestWeight = 0;
  for (const [lang, w] of weights) {
    if (w > bestWeight || (w === bestWeight && best !== null && lang < best)) {
      best = lang;
      bestWeight = w;
    }
  }
  return best;
}

function shuffledEpithets(seed: number): string[] {
  const rng = mulberry32(seed);
  const out = [...EPITHETS];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
