import type { SimModule } from './api.ts';
import { generateMap } from './mapgen.ts';
import { checksum, restore, snapshot } from './snapshot.ts';
import { createWorld, step } from './world.ts';

export { generateMap, createWorld, step, snapshot, restore, checksum };

export const sim: SimModule = { generateMap, createWorld, step, snapshot, restore, checksum };
