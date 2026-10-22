import WebSocket from 'ws';
import { writeFileSync } from 'node:fs';
import { sim } from '../src/sim/index.ts';
import { NEUTRAL, type World } from '../src/sim/api.ts';

const url = process.argv[2] ?? 'ws://localhost:8787/ws';
const minutes = Number(process.argv[3] ?? 10);
const out = process.argv[4];

function report(w: World, label: string) {
  const owners = w.objectives.map((o) => (o.owner === NEUTRAL ? '.' : String(o.owner))).join('');
  const alive = w.factions.map((f) => w.units.filter((u) => u.faction === f.id).length);
  const neutral = w.units.filter((u) => u.faction === NEUTRAL).length;
  const orders = w.factions.map((f) => {
    const ps = w.players.filter((p) => p.faction === f.id);
    return `${f.id}:[${ps.map((p) => `${p.orderObjectiveId}${p.retreating ? 'r' : ''}`).join(',')}]`;
  });
  console.log(`${label} tick ${w.tick} owners [${owners}] alive ${alive.join('/')} neutral ${neutral} hexes ${w.factions.map((f) => f.hexesHeld).join('/')}`);
  console.log(`  orders ${orders.join(' ')}`);
}

const ws = new WebSocket(url);
ws.on('message', (raw) => {
  const m = JSON.parse(String(raw));
  if (m.type !== 'hello') return;
  ws.close();
  if (out) writeFileSync(out, JSON.stringify(m.snapshot));
  const w = sim.restore(m.snapshot);
  console.log('objectives', w.map.objectives.map((o) => `${o.id}:${o.kind[0]}${o.homeFaction}`).join(' '));
  report(w, 'now');
  let captures = 0;
  for (let i = 1; i <= minutes * 600; i++) {
    captures += sim.step(w, []).captures.length;
    if (i % 600 === 0) report(w, `+${i / 600}m captures ${captures}`);
  }
});
