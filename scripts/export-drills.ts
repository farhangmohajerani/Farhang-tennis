// Writes exports/drills.json and exports/drills.csv from the seed (npx tsx scripts/export-drills.ts).
import fs from 'node:fs';
import { SEED_DRILLS } from '../src/data/drills';
import { drillsToCSV, drillsToJSON } from '../src/lib/drillIO';
fs.mkdirSync('exports', { recursive: true });
fs.writeFileSync('exports/drills.json', drillsToJSON(SEED_DRILLS));
fs.writeFileSync('exports/drills.csv', '﻿' + drillsToCSV(SEED_DRILLS));
console.log(`exported ${SEED_DRILLS.length} drills`);
