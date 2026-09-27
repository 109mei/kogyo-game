/**
 * npm run fuzz -- [runs=45] [steps=500]
 * Throws random commands (the kinds the UI can send) at the rule engine with
 * time passing in between, and checks invariants after every step: no
 * exceptions, no NaN, no negative stock, no dangling references, and a save
 * that round-trips. See tools/fuzz-lib.ts.
 */
import { fuzzRun } from './fuzz-lib';

const runs = Number(process.argv[2] ?? 45);
const steps = Number(process.argv[3] ?? 500);
const failures: string[] = [];
const counts: Record<string, { ok: number; no: number }> = {};
const t0 = performance.now();
for (let run = 0; run < runs; run++) {
  const res = fuzzRun(run, steps);
  for (const [k, v] of Object.entries(res.counts)) {
    const c = (counts[k] ??= { ok: 0, no: 0 });
    c.ok += v.ok;
    c.no += v.no;
  }
  if (res.failure) failures.push(res.failure);
}
const ms = performance.now() - t0;
console.log(`${runs} runs x ${steps} steps in ${(ms / 1000).toFixed(1)}s`);
console.log('commands (ok/refused):', Object.entries(counts).map(([k, v]) => `${k} ${v.ok}/${v.no}`).join(', '));
if (failures.length) {
  console.log(`\n${failures.length} FAILURES`);
  for (const f of failures) console.log(`- ${f}`);
  process.exitCode = 1;
} else console.log('no invariant broken');
