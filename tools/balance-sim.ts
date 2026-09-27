/**
 * npm run balance -- [days=720] [seed=1] [--log]
 * Plays the game with the scripted bot and prints pacing milestones and a
 * monthly timeline. Uses the same rule engine as the game.
 */
import { DATA } from '../src/data';
import { createInitialState, dayOf } from '../src/core';
import { automationRate, avgProfit, companyValue } from '../src/core/finance';
import { Bot } from './bot';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const days = Number(args[0] ?? 720);
const seed = Number(args[1] ?? 1);
const verbose = process.argv.includes('--log');

const man = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(2)}兆`;
  if (a >= 1e8) return `${(v / 1e8).toFixed(2)}億`;
  return `${Math.round(v / 1e4).toLocaleString()}万`;
};

const s = createInitialState({ seed });
const bot = new Bot(s, { log: verbose ? (e) => console.log(`d${e.day.toFixed(1)} ${e.text}`) : undefined });
const t0 = performance.now();
console.log('day | cash | value | profit/day | emp | fac | auto% | power kW (use) | logi t/d | research');
for (let d = 0; d < days; d += 30) {
  bot.play(Math.min(30, days - d));
  const p = s.power;
  console.log(
    [
      Math.round(dayOf(s.tick)),
      man(s.cash),
      man(companyValue(s)),
      man(avgProfit(s, 7)),
      s.employees.length,
      s.facilities.filter((f) => f.level > 0).length,
      (automationRate(s) * 100).toFixed(0),
      `${Math.round(p.demand)}/${Math.round(p.supply)}`,
      `${Math.round(s.logistics.load)}/${Math.round(s.logistics.capacity)}`,
      `${s.research.done.length} ${s.research.current ?? '-'}`,
    ].join(' | '),
  );
}
const ms = performance.now() - t0;
console.log('\nfirsts (game day):');
for (const [k, v] of Object.entries(bot.firsts)) console.log(`  ${k.padEnd(14)} ${v.toFixed(1)}`);
console.log('\ngoals done:', s.goals.done.length, '/', DATA.goals.length, ' next:', DATA.goals[s.goals.index]?.title ?? '-');
console.log('research done:', s.research.done.join(' '));
console.log('facilities:', s.facilities.map((f) => `${f.type}/${f.recipe}/${f.stage}x${f.machines}/L${f.level}`).join('  '));
const fails = Object.entries(bot.failures).sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log('\nmost common refusals:', fails.map(([k, v]) => `${v}× ${k}`).join('\n  '));
console.log(`\nsimulated ${days} days in ${(ms / 1000).toFixed(1)}s (${((days * DATA.balance.time.ticksPerDay) / (ms / 1000) / 1000).toFixed(0)}k ticks/s)`);
console.log('problems now:', s.problems.map((p) => `${p.level}:${p.title}`).join(', '));
console.log('history:', s.history.slice(-25).map((h) => `${h.day}:${h.text}`).join(' / '));
