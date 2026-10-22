import type { SimModule } from '../sim/api.ts';
import * as impl from './dev/placeholderSim.ts';

export const sim: SimModule = impl;
