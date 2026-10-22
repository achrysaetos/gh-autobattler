import WebSocket from 'ws';
import { sim } from '../src/sim/index.ts';
const ws = new WebSocket(process.argv[2] ?? 'ws://localhost:8787/ws');
let world: any; const pending: any[] = []; let checks = 0, ok = 0; const mine: number[] = [];
ws.on('message', (raw) => {
  const m = JSON.parse(String(raw));
  if (m.type === 'hello') {
    world = sim.restore(m.snapshot); pending.push(...m.inputs);
    const p = world.players.find((p: any) => p.playerId === Number(process.argv[3]));
    console.log('hello tick', world.tick, 'players', m.players.length, 'factions', m.factions.map((f: any) => f.name).join(', '), 'me target', p?.target);
  } else if (m.type === 'inputs') pending.push(...m.inputs);
  else if (m.type === 'check') {
    pending.sort((a, b) => a.tick - b.tick || a.seq - b.seq);
    while (world.tick < m.tick) {
      const due = []; while (pending.length && pending[0].tick <= world.tick) due.push(pending.shift().input);
      sim.step(world, due);
    }
    checks++; if (sim.checksum(world) === m.checksum) ok++;
    if (checks === 6) { console.log(`checksums matched ${ok}/${checks} at tick ${world.tick}, alive ${world.units.length}`); process.exit(0); }
  } else if (m.type === 'feed') console.log('feed:', m.item.message);
});
