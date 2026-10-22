import type { SimInput, TickEvents, TimedInput, World } from '../../sim/api.ts';
import type { ServerMessage } from '../../protocol.ts';
import { sim } from '../simModule.ts';
import type { Store } from '../store.ts';
import { transition, type ConnEvent, type ResyncReason } from './connection.ts';
import type { Connect, Transport } from './transport.ts';

const MAX_STEPS_PER_FRAME = 30;
const MAX_BEHIND_TICKS = 600;
const SYNC_BUDGET_MS = 12;
const CHECKSUM_HISTORY = 128;
const FX_TAIL_STEPS = 3;

export type StepListener = (events: TickEvents, world: World) => void;

export class LockstepRunner {
  private transport: Transport | null = null;
  private queue = new Map<number, TimedInput[]>();
  private seenSeq = new Set<number>();
  private localChecksums = new Map<number, number>();
  private pendingChecks = new Map<number, number>();
  private offset = 0;
  private roundStartMs = 0;
  private tickMs = 100;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stepListeners = new Set<StepListener>();
  private prevIndex = new Map<number, number>();
  private prevXY = new Float64Array(0);
  alpha = 1;

  constructor(
    private connect: Connect,
    private store: Store,
  ) {
    store.serverNow = () => Date.now() + this.offset;
  }

  start(): void {
    this.open();
  }

  onStep(fn: StepListener): () => void {
    this.stepListeners.add(fn);
    return () => this.stepListeners.delete(fn);
  }

  previousPosition(unitId: number, out: { x: number; y: number }): boolean {
    const i = this.prevIndex.get(unitId);
    if (i === undefined) return false;
    out.x = this.prevXY[i * 2]!;
    out.y = this.prevXY[i * 2 + 1]!;
    return true;
  }

  frame(): void {
    const world = this.store.world;
    const phase = this.store.conn.phase;
    if (!world || (phase !== 'live' && phase !== 'syncing')) return;
    const exact = (Date.now() + this.offset - this.roundStartMs) / this.tickMs;
    const target = Math.floor(exact);
    const behind = target - world.tick;

    if (phase === 'syncing') {
      const started = performance.now();
      while (world.tick < target && performance.now() - started < SYNC_BUDGET_MS) this.advance(world, false);
      if (world.tick >= target) {
        this.capturePrevious(world);
        this.dispatch({ type: 'caught-up' });
      }
      this.alpha = 1;
      return;
    }

    if (behind > MAX_BEHIND_TICKS) {
      this.requestResync('behind');
      return;
    }
    const steps = Math.min(MAX_STEPS_PER_FRAME, Math.max(0, behind));
    for (let i = 0; i < steps; i++) {
      if (i === steps - 1) this.capturePrevious(world);
      if (this.store.conn.phase !== 'live') return;
      this.advance(world, steps - i <= FX_TAIL_STEPS);
    }
    this.alpha = world.tick >= target ? Math.min(1, Math.max(0, exact - target)) : 1;
  }

  private advance(world: World, emit: boolean): void {
    const due = this.queue.get(world.tick);
    let inputs: SimInput[] = [];
    if (due) {
      this.queue.delete(world.tick);
      due.sort((a, b) => a.seq - b.seq);
      inputs = due.map((t) => t.input);
      for (const t of due) this.seenSeq.delete(t.seq);
    }
    const events = sim.step(world, inputs);
    const sum = sim.checksum(world);
    this.localChecksums.set(world.tick, sum);
    this.localChecksums.delete(world.tick - CHECKSUM_HISTORY);
    const expected = this.pendingChecks.get(world.tick);
    if (expected !== undefined) {
      this.pendingChecks.delete(world.tick);
      if (expected !== sum) {
        this.requestResync('desync');
        return;
      }
    }
    if (emit) {
      this.store.ingest(events, world);
      for (const fn of this.stepListeners) fn(events, world);
    }
  }

  private capturePrevious(world: World): void {
    const n = world.units.length;
    if (this.prevXY.length < n * 2) this.prevXY = new Float64Array(n * 2 + 512);
    this.prevIndex.clear();
    for (let i = 0; i < n; i++) {
      const u = world.units[i]!;
      this.prevIndex.set(u.id, i);
      this.prevXY[i * 2] = u.x;
      this.prevXY[i * 2 + 1] = u.y;
    }
  }

  private open(): void {
    this.transport?.close();
    this.transport = this.connect({
      onMessage: (msg) => this.handle(msg),
      onClose: () => this.handleClose(),
    });
  }

  private handleClose(): void {
    this.transport = null;
    this.dispatch({ type: 'closed', now: Date.now() });
    const conn = this.store.conn;
    if (conn.phase !== 'offline') return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.dispatch({ type: 'retry' });
      this.open();
    }, conn.retryAt - Date.now());
  }

  private requestResync(reason: ResyncReason): void {
    if (this.store.conn.phase !== 'live') return;
    this.dispatch({ type: 'resync', reason });
    this.transport?.send({ type: 'resync' });
  }

  private dispatch(event: ConnEvent): void {
    const next = transition(this.store.conn, event);
    if (next === this.store.conn) return;
    this.store.conn = next;
    this.store.publish();
  }

  private enqueue(inputs: readonly TimedInput[], currentTick: number): boolean {
    for (const t of inputs) {
      if (this.seenSeq.has(t.seq)) continue;
      if (t.tick < currentTick) return false;
      this.seenSeq.add(t.seq);
      const list = this.queue.get(t.tick);
      if (list) list.push(t);
      else this.queue.set(t.tick, [t]);
    }
    return true;
  }

  private handle(msg: ServerMessage): void {
    const store = this.store;
    switch (msg.type) {
      case 'hello': {
        const world = sim.restore(msg.snapshot);
        this.queue.clear();
        this.seenSeq.clear();
        this.localChecksums.clear();
        this.pendingChecks.clear();
        this.prevIndex.clear();
        this.offset = msg.serverNow - Date.now();
        this.roundStartMs = msg.roundStartMs;
        this.tickMs = msg.tickMs;
        this.enqueue(msg.inputs, world.tick);
        store.world = world;
        store.round = msg.round;
        store.factions = msg.factions;
        store.players = new Map(msg.players.map((p) => [p.playerId, p]));
        store.feed = [];
        for (const item of msg.feed) store.addFeed(item);
        store.viewerPlayerId = msg.viewerPlayerId;
        store.resetDerived();
        this.dispatch({ type: 'hello' });
        store.publish();
        return;
      }
      case 'inputs': {
        const world = store.world;
        if (!world) return;
        if (!this.enqueue(msg.inputs, world.tick)) this.requestResync('late-input');
        return;
      }
      case 'check': {
        const world = store.world;
        if (!world) return;
        if (msg.tick > world.tick) {
          this.pendingChecks.set(msg.tick, msg.checksum);
          return;
        }
        const local = this.localChecksums.get(msg.tick);
        if (local !== undefined && local !== msg.checksum) this.requestResync('desync');
        return;
      }
      case 'player':
        store.players.set(msg.player.playerId, msg.player);
        return;
      case 'feed':
        store.addFeed(msg.item);
        return;
      case 'round':
        store.round = msg.round;
        store.publish();
        return;
    }
  }
}
