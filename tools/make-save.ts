/**
 * npm run make-save -- <days> [seed=1] [out=tools/out/save-<days>.json]
 * Plays the bot for some days and writes a save envelope (the same JSON the
 * game keeps in localStorage). Used to look at mid/late-game screens.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInitialState } from '../src/core';
import { serialize } from '../src/save/SaveStore';
import { Bot } from './bot';

const [daysArg = '120', seedArg = '1', outArg] = process.argv.slice(2);
const days = Number(daysArg);
const s = createInitialState({ seed: Number(seedArg), companyName: 'みどり工業' });
new Bot(s).play(days);
s.speed = 1;
s.paused = false;
s.pauseReason = null;
const out = outArg ?? `tools/out/save-${days}.json`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, serialize(s));
console.log(`wrote ${out} (${(serialize(s).length / 1024).toFixed(0)} KB) day ${days}, facilities ${s.facilities.length}, employees ${s.employees.length}`);
