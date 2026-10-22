import type { SimModule } from '../sim/api.ts';
import { sim as impl } from '../sim/index.ts';

export { captureFull } from '../sim/index.ts';
export const sim: SimModule = impl;
