import { TICK_MS } from '../sim/api.ts';
import { MAX_STEPS_PER_LOOP, type Battle } from './battle.ts';
import { errorMessage, type Logger } from './log.ts';

const RECONCILE_MS = 2000;

export interface Lifecycle {
  readonly name: string;
  battles(): Battle[];
  reconcile(now: number): void;
}

export class Scheduler {
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly lifecycles: readonly Lifecycle[],
    private readonly log: Logger,
  ) {}

  start(clock: () => number = Date.now): void {
    this.timers.push(setInterval(() => this.tick(clock()), TICK_MS));
    this.timers.push(setInterval(() => this.reconcile(clock()), RECONCILE_MS));
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  // Round-robin one step at a time so a world catching up cannot starve the others,
  // and the shared budget bounds how long one interval can hold the event loop.
  tick(now: number, budget: number = MAX_STEPS_PER_LOOP): void {
    let behind = this.lifecycles.flatMap((l) => l.battles()).filter((b) => b.behind(now));
    let spent = 0;
    while (spent < budget && behind.length > 0) {
      for (const b of behind) {
        if (spent >= budget) break;
        spent++;
        try {
          b.step();
        } catch (err) {
          this.log.error('tick failed', { round: b.round.id, room: b.round.roomSlug, error: errorMessage(err) });
          behind = behind.filter((x) => x !== b);
        }
      }
      behind = behind.filter((b) => b.behind(now));
    }
  }

  reconcile(now: number): void {
    for (const l of this.lifecycles) {
      try {
        l.reconcile(now);
      } catch (err) {
        this.log.error(`${l.name} reconcile failed`, { error: errorMessage(err) });
      }
    }
  }
}
