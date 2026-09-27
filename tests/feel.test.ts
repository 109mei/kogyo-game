/**
 * Feel targets from docs/SPEC.md §5, measured with the scripted player.
 */
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/core';
import { DATA } from '../src/data';
import { Bot } from '../tools/bot';
import { recipeEcon } from '../tools/econ-report';

describe('economy table', () => {
  const salary = DATA.balance.staff.roles.worker.salary / 30;
  it('hand work pays 0.4x..8x a salary per worker-day for every recipe', () => {
    for (const r of DATA.recipes) {
      const e = recipeEcon(r.id);
      if (e.manualProfit === null) continue;
      const k = (e.manualProfit + salary) / salary;
      expect(k, r.id).toBeGreaterThan(1.4);
      expect(k, r.id).toBeLessThan(9);
    }
  });

  it('a machine pays for itself in 5..120 days at base prices', () => {
    for (const r of DATA.recipes) {
      const e = recipeEcon(r.id);
      expect(e.machinePayback, r.id).toBeGreaterThan(5);
      expect(e.machinePayback, r.id).toBeLessThan(120);
    }
  });

  it('automation pays back within a year when it frees an operator', () => {
    for (const r of DATA.recipes) expect(recipeEcon(r.id).autoPayback, r.id).toBeLessThan(365);
  });
});

describe('pacing with the scripted player', () => {
  const runs = [1, 2].map((seed) => {
    const bot = new Bot(createInitialState({ seed }));
    bot.play(420);
    return bot;
  });

  it.each([0, 1])('seed %i: the first hire comes within 3 days', (i) => {
    expect(runs[i].firsts.firstHire).toBeLessThanOrEqual(3);
  });

  it.each([0, 1])('seed %i: the first new facility within 60 days', (i) => {
    expect(runs[i].firsts.firstBuild).toBeLessThanOrEqual(60);
  });

  it.each([0, 1])('seed %i: the first machine between day 30 and 250', (i) => {
    expect(runs[i].firsts.firstMachine).toBeGreaterThan(30);
    expect(runs[i].firsts.firstMachine).toBeLessThan(250);
  });

  it.each([0, 1])('seed %i: worth 28.4M yen (cash + plant) within 200 days', (i) => {
    expect(runs[i].firsts.worth2840man).toBeLessThan(200);
  });

  it.each([0, 1])('seed %i: rule-based automation is in use by day 400', (i) => {
    expect(runs[i].firsts.firstRules).toBeLessThan(400);
  });

  it.each([0, 1])('seed %i: the company is growing and solvent at day 420', (i) => {
    const s = runs[i].s;
    expect(s.cash + s.loan).toBeGreaterThan(0);
    const d = s.finance.days.slice(-14);
    const profit = d.reduce((t, r) => t + r.sales - r.purchases - r.salaries - r.power - r.logistics - r.upkeep - r.interest - r.other, 0) / d.length;
    expect(profit).toBeGreaterThan(1_000_000);
  });
});
