/**
 * npm run econ
 * Writes docs/ECONOMY.md: base prices, market sizes and, for every recipe,
 * the economics of each stage at base prices. The numbers come straight from
 * src/data, so the document cannot drift from the game.
 */
import { writeFileSync } from 'node:fs';
import { DATA } from '../src/data';

const b = DATA.balance;
const SALARY_DAY = b.staff.roles.worker.salary / 30;
const GRID = b.power.contracts.find((c) => c.id === 'high')!.energyPrice;
const FREIGHT = b.logistics.costPerTon;

const yen = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e8) return `${(v / 1e8).toFixed(2)}億`;
  if (a >= 1e4) return `${(v / 1e4).toFixed(a >= 1e6 ? 0 : 1)}万`;
  return `${Math.round(v).toLocaleString()}`;
};

export interface StageEcon {
  recipe: string;
  facility: string;
  /** manual: yen profit per worker-day */
  manualProfit: number | null;
  /** machine: yen profit per machine-day and payback days */
  machineProfit: number;
  machinePayback: number;
  autoProfit: number;
  /** payback of converting one machine to automatic when the freed operator runs another machine */
  autoPayback: number;
  /** machines that would sell the whole market's daily volume */
  marketMachines: number;
  powerShare: number;
}

export function recipeEcon(id: string): StageEcon {
  const r = DATA.recipe[id];
  const f = DATA.facility[r.facility];
  const it = DATA.item[id];
  const sell = 1 - b.market.sellSpread;
  const revenue = r.output * DATA.basePrice[id] * sell;
  let inputs = 0;
  for (const [inp, q] of Object.entries(r.inputs)) inputs += q * DATA.basePrice[inp];
  const freight = it.transport === 'truck' ? r.output * it.weight * FREIGHT : 0;
  const margin = revenue - inputs - freight; // per batch
  const manualProfit = f.manualWorkers ? margin / r.time - SALARY_DAY : null;
  const m = f.machine!;
  const a = f.auto!;
  const mPower = m.power * r.powerMul * 24 * GRID;
  const mUpkeep = m.cost * b.production.machineUpkeepRate;
  const machineProfit = (m.rate / r.time) * margin - m.operators * SALARY_DAY - mPower - mUpkeep;
  const aPower = a.power * r.powerMul * 24 * GRID;
  const aUpkeep = m.cost * b.production.machineUpkeepRate + a.cost * b.production.autoUpkeepRate;
  const autoProfit = (a.rate / r.time) * margin - aPower - aUpkeep;
  const extra = autoProfit - machineProfit + m.operators * Math.max(0, machineProfit);
  return {
    recipe: id,
    facility: f.id,
    manualProfit,
    machineProfit,
    machinePayback: machineProfit > 0 ? m.cost / machineProfit : Infinity,
    autoProfit,
    autoPayback: extra > 0 ? a.cost / extra : Infinity,
    marketMachines: it.demand / ((m.rate / r.time) * r.output),
    powerShare: mPower / Math.max(1, (m.rate / r.time) * margin),
  };
}

function main() {
  const lines: string[] = [];
  lines.push('# ECONOMY — 生成物（`npm run econ`）', '');
  lines.push(`src/data から計算した基準価格と採算。給与 ${yen(SALARY_DAY)}円/日、電力 ${GRID}円/kWh（高圧）、運賃 ${FREIGHT}円/t、売り手数料 ${(b.market.sellSpread * 100).toFixed(0)}%、付加価値倍率 ${b.economy.valueScale}。`, '');
  lines.push('- 手作業：作業員1人1日の利益（材料は基準価格で買う想定）');
  lines.push('- 機械：機械1台1日の利益（操作員・電力・保守を引く）と、機械代の回収日数');
  lines.push('- 自動化：自動機への改造費を、空いた操作員が別の機械を動かす前提で回収する日数');
  lines.push('- 市場飽和：市場の1日の取引量を作るのに要る機械の台数', '');
  lines.push('| No | 品目 | 基準価格 | 市場/日 | 施設 | 手作業 利益/人日 | 機械 利益/台日 | 機械 回収日 | 自動 回収日 | 市場飽和(台) | 電力比 |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const it of DATA.items) {
    const e = recipeEcon(it.id);
    const f = DATA.facility[e.facility];
    lines.push(
      `| ${it.no} | ${it.name} | ${yen(DATA.basePrice[it.id])}/${it.unit} | ${it.demand.toLocaleString()}${it.unit} | ${f.short} | ${e.manualProfit === null ? '—' : yen(e.manualProfit)} | ${yen(e.machineProfit)} | ${e.machinePayback.toFixed(0)} | ${e.autoPayback.toFixed(0)} | ${e.marketMachines.toFixed(0)} | ${(e.powerShare * 100).toFixed(0)}% |`,
    );
  }
  lines.push('', '## 施設', '');
  lines.push('| No | 施設 | 解放 | 建設費 | 日数 | 維持費/日 | 手作業 人/Lv | 機械 台/Lv | 機械 価格 | 機械 kW | 自動 改造費 | 自動 kW |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const f of DATA.facilities) {
    lines.push(
      `| ${f.no} | ${f.name} | ${f.unlock === 'start' ? '最初から' : DATA.tech[f.unlock]?.name ?? f.unlock} | ${yen(f.buildCost)} | ${f.buildDays} | ${yen(f.upkeep)} | ${f.manualWorkers ?? '—'} | ${f.machinesPerLevel} | ${f.machine ? yen(f.machine.cost) : f.generator ? yen(f.generator.unitCost) : '—'} | ${f.machine?.power ?? (f.generator ? `+${f.generator.capacity}` : '—')} | ${f.auto ? yen(f.auto.cost) : f.generator ? yen(f.generator.autoCost) : '—'} | ${f.auto?.power ?? '—'} |`,
    );
  }
  lines.push('', '## 研究', '');
  lines.push('| 研究 | 分野 | RP | 前提 | 解放・効果 |');
  lines.push('|---|---|---|---|---|');
  for (const t of DATA.techs) {
    const u = DATA.unlockedBy[t.id];
    const unlocks = [...(u?.facilities ?? []).map((x) => DATA.facility[x].name), ...(u?.recipes ?? []).map((x) => DATA.item[x].name), ...(u?.contracts ?? []).map((x) => `契約:${x}`)];
    const eff = t.effects.map((e) => (e.type === 'feature' ? `機能:${e.feature}` : `${e.type}${'value' in e ? ` ${e.value > 0 ? '+' : ''}${e.value}` : ''}`));
    lines.push(`| ${t.name} | ${t.category} | ${t.cost} | ${t.requires.map((r) => DATA.tech[r].name).join('、') || '—'} | ${[...unlocks, ...eff].join('、') || '—'} |`);
  }
  writeFileSync('docs/ECONOMY.md', lines.join('\n') + '\n');
  console.log(lines.slice(0, 80).join('\n'));
}

if (process.argv[1]?.endsWith('econ-report.ts')) main();
