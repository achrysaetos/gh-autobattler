import type { MapDef } from './api.ts';
import { buildFlowField, cellAt, type FlowField } from './flowfield.ts';
import { buildHexLookup, type HexLookup } from './hex.ts';

// Everything here is a pure function of the MapDef, so it is rebuilt on restore
// instead of being shipped in snapshots.
export interface Derived {
  flow: FlowField[];
  hexLookup: HexLookup;
  // For each hex, the objective whose owner it drifts back to when empty, or -1.
  hexAnchor: Int32Array;
}

const cache = new WeakMap<MapDef, Derived>();

export function derived(map: MapDef): Derived {
  let d = cache.get(map);
  if (!d) {
    d = build(map);
    cache.set(map, d);
  }
  return d;
}

const ANCHOR_REACH = 1.9;

function build(map: MapDef): Derived {
  const flow = map.objectives.map((o) => buildFlowField(map, cellAt(map, o.x, o.y)));
  const hexAnchor = new Int32Array(map.hexes.length).fill(-1);
  for (let h = 0; h < map.hexes.length; h++) {
    const hex = map.hexes[h]!;
    let best = Infinity;
    for (const o of map.objectives) {
      const reach = o.radius + map.hexSize * ANCHOR_REACH;
      const dx = hex.x - o.x;
      const dy = hex.y - o.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= reach * reach && d2 < best) {
        best = d2;
        hexAnchor[h] = o.id;
      }
    }
  }
  return { flow, hexLookup: buildHexLookup(map.hexes, map.hexSize), hexAnchor };
}
