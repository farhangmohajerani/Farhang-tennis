import { DrillSchema, type Drill } from '../../types';
import { forehandDrills } from './forehand';
import { backhandDrills } from './backhand';
import { serveDrills } from './serve';
import { returnDrills } from './return';
import { volleyDrills } from './volley';
import { footworkDrills } from './footwork';
import { defenseDrills } from './defense';
import { tacticalDrills } from './tactical';
import { pointplayDrills } from './pointplay';
import { mentalDrills } from './mental';

/** All 200 seeded drills, validated against the schema at module load. */
export const SEED_DRILLS: Drill[] = [
  ...forehandDrills,
  ...backhandDrills,
  ...serveDrills,
  ...returnDrills,
  ...volleyDrills,
  ...footworkDrills,
  ...defenseDrills,
  ...tacticalDrills,
  ...pointplayDrills,
  ...mentalDrills,
].map((d) => DrillSchema.parse(d));
