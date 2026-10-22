import WebSocket from 'ws';
import type { ServerMessage } from '../src/protocol.ts';
import type { TimedInput, World } from '../src/sim/api.ts';
import { sim } from '../src/sim/index.ts';

const url = process.argv[2] ?? 'ws://localhost:8787/ws';
const watchedPlayer = Number(process.argv[3]);
const CHECKS = 6;

let world: World | null = null;
const pending: TimedInput[] = [];
let checks = 0;
let matched = 0;

const ws = new WebSocket(url);
ws.on('message', (raw) => {
  const m = JSON.parse(String(raw)) as ServerMessage;
  if (m.type === 'hello') {
    world = sim.restore(m.snapshot);
    pending.push(...m.inputs);
    const watched = world.players.find((p) => p.playerId === watchedPlayer);
    console.log('hello tick', world.tick, 'players', m.players.length, 'factions', m.factions.map((f) => f.name).join(', '), 'watched target', watched?.target);
  } else if (m.type === 'inputs') {
    pending.push(...m.inputs);
  } else if (m.type === 'feed') {
    console.log('feed:', m.item.message);
  } else if (m.type === 'check' && world) {
    pending.sort((a, b) => a.tick - b.tick || a.seq - b.seq);
    while (world.tick < m.tick) {
      const due = [];
      while (pending.length > 0 && pending[0]!.tick <= world.tick) due.push(pending.shift()!.input);
      sim.step(world, due);
    }
    checks++;
    if (sim.checksum(world) === m.checksum) matched++;
    if (checks === CHECKS) {
      console.log(`checksums matched ${matched}/${checks} at tick ${world.tick}, alive ${world.units.length}`);
      process.exit(matched === checks ? 0 : 1);
    }
  }
});
