import { addDays, DAY_MS, isoDay } from '../rules/days.ts';
import { hashString, mulberry32, pick, type Rng } from '../rules/prng.ts';
import type { Contribution, ContributionKind, IsoDay } from '../rules/types.ts';
import type { Store } from './db.ts';
import type { Campaign } from './campaign.ts';
import type { Ingest } from './ingest.ts';
import { errorMessage, type Logger } from './log.ts';

export const DEMO_ID_BASE = 10_000_000_000;

const ADJECTIVES = ['quiet', 'amber', 'mossy', 'brisk', 'hollow', 'tidal', 'ember', 'lunar', 'rusty', 'velvet', 'copper', 'misty', 'jade', 'stormy', 'gentle', 'iron'];
const NOUNS = ['falcon', 'anvil', 'lantern', 'otter', 'quill', 'harbor', 'thistle', 'comet', 'badger', 'willow', 'kiln', 'heron', 'pylon', 'marrow', 'sparrow', 'cinder'];
const ORGS = ['lanternworks', 'quillforge', 'emberlabs', 'tidepool-dev', 'mossbyte', 'copperkiln'];
const PROJECTS = ['atlas', 'beacon', 'cartograph', 'driftwood', 'ferry', 'gantry', 'hearth', 'isobar', 'juniper', 'keystone'];
const LANGUAGES = ['TypeScript', 'Rust', 'Go', 'Python', 'Kotlin', 'Elixir', 'C++', 'Ruby'];
const AVATAR_COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#9a6324'];
const DEMO_SEED = 0x5eed;
const TICKER_MS = 20_000;

interface DemoPersona {
  id: number;
  login: string;
  language: string;
  repos: string[];
  diligence: number;
}

function persona(index: number): DemoPersona {
  const rng = mulberry32(DEMO_SEED + index * 7919);
  const n = ADJECTIVES.length;
  const adjective = ADJECTIVES[index % n]!;
  const noun = NOUNS[(5 * (index % n) + Math.floor(index / n)) % n]!;
  const login = `${adjective}${noun}${index >= n * n ? index : ''}`;
  const repos = Array.from({ length: 1 + Math.floor(rng() * 3) }, () => `${pick(rng, ORGS)}/${pick(rng, PROJECTS)}`);
  return { id: DEMO_ID_BASE + index, login, language: pick(rng, LANGUAGES), repos: [...new Set(repos)], diligence: 0.2 + rng() * 0.75 };
}

function avatar(login: string): string {
  const color = AVATAR_COLORS[hashString(login) % AVATAR_COLORS.length]!;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="${color}"/><text x="32" y="42" font-size="30" font-family="sans-serif" text-anchor="middle" fill="#fff">${login[0]!.toUpperCase()}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function synthetic(p: DemoPersona, rng: Rng, kind: ContributionKind, day: IsoDay, count: number, serial: string): Contribution {
  const repo = pick(rng, p.repos);
  const base = { kind, day, count, repo, language: p.language };
  if (kind === 'commits') return { ...base, sourceId: `commits:${repo}:${day}`, url: null, title: null };
  return { ...base, sourceId: `${kind === 'review' ? 'review' : 'pr'}:demo:${p.id}:${serial}`, url: null, title: null };
}

function history(p: DemoPersona, today: IsoDay): Contribution[] {
  const rng = mulberry32(DEMO_SEED ^ hashString(p.login));
  const out = new Map<string, Contribution>();
  for (let i = 0; i < 28; i++) {
    const day = addDays(today, -i);
    if (rng() > p.diligence) continue;
    const commits = synthetic(p, rng, 'commits', day, 1 + Math.floor(rng() * rng() * 12), '');
    const prior = out.get(commits.sourceId);
    out.set(commits.sourceId, prior ? { ...prior, count: prior.count + commits.count } : commits);
    if (rng() < p.diligence * 0.5) {
      const c = synthetic(p, rng, 'review', day, 1, `${day}:r`);
      out.set(c.sourceId, c);
    }
    if (rng() < p.diligence * 0.3) {
      const c = synthetic(p, rng, 'merged_pr', day, 1, `${day}:m`);
      out.set(c.sourceId, c);
    }
  }
  return [...out.values()];
}

export function seedDemoPlayers(store: Store, count: number, now: number): number[] {
  const today = isoDay(now);
  const created: number[] = [];
  store.transaction(() => {
    for (let i = 1; i <= count; i++) {
      const p = persona(i);
      if (store.player(p.id)) continue;
      store.upsertPlayer({ id: p.id, nodeId: `demo:${p.id - DEMO_ID_BASE}`, login: p.login, avatarUrl: avatar(p.login), createdAtGithub: now - 730 * DAY_MS, enlistedAt: now, demo: true });
      store.upsertContributions(p.id, history(p, today), now);
      store.markPolled(p.id, now, null);
      created.push(p.id);
    }
  });
  return created;
}

export class DemoTicker {
  private timer: NodeJS.Timeout | null = null;
  private serial = 0;
  private readonly rng: Rng;

  constructor(
    private readonly deps: { store: Store; ingest: Ingest; campaign: Campaign; log: Logger; clock?: () => number },
    seed: number = Date.now(),
  ) {
    this.rng = mulberry32(seed);
  }

  start(): void {
    const next = () => {
      this.timer = setTimeout(() => {
        try {
          this.tick();
        } catch (err) {
          this.deps.log.error('demo ticker failed', { error: errorMessage(err) });
        }
        next();
      }, TICKER_MS * (0.75 + this.rng() * 0.5));
    };
    next();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  tick(): void {
    const now = this.deps.clock?.() ?? Date.now();
    const demos = this.deps.store.players().filter((p) => p.demo);
    if (demos.length === 0) return;
    const player = pick(this.rng, demos);
    const p = persona(-player.id);
    const roll = this.rng();
    const kind: ContributionKind = roll < 0.7 ? 'commits' : roll < 0.9 ? 'review' : 'merged_pr';
    const c = synthetic(p, this.rng, kind, isoDay(now), kind === 'commits' ? 1 + Math.floor(this.rng() * 4) : 1, `${now}:${++this.serial}`);
    if (kind === 'commits') c.count += this.deps.store.contribution(player.id, c.sourceId)?.count ?? 0;
    this.deps.campaign.enlist(player.id, now);
    this.deps.ingest.apply(player.id, [c], now);
  }
}

export function enlistDemoPlayers(store: Store, campaign: Campaign, now: number): void {
  for (const p of store.players()) if (p.demo) campaign.enlist(p.id, now);
  campaign.remuster(now);
}
