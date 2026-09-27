import { DATA } from '../data';
import { defOf, levelUpCost, isProduction } from './facilities';
import { avgProfit, loanLimit } from './finance';
import { managementCapacity, managementFactor, managementLoad } from './logistics';
import { buyQuote, unitPrice } from './market';
import { contractAvailable, isPlant } from './power';
import { divisionFor, inSubsidiary } from './org';
import { storageCapacity, storedWeight } from './production';
import { surplusPlan } from './surplus';
import { plannedFlows } from './rates';
import { techAvailable } from './research';
import { staffCapacity, employeesAt } from './staff';
import type { FacilityState, GameState, Problem, Solution } from './types';
import { hasFeature, techDone, unlocked } from './util';

const yen = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(1)}兆円`;
  if (a >= 1e8) return `${(v / 1e8).toFixed(1)}億円`;
  if (a >= 1e4) return `${Math.round(v / 1e4).toLocaleString()}万円`;
  return `${Math.round(v).toLocaleString()}円`;
};

const qtyText = (v: number, unit: string) => {
  const a = Math.abs(v);
  const s = a >= 100 ? Math.round(v).toLocaleString() : a >= 10 ? v.toFixed(1) : v.toFixed(2);
  return `${s}${unit}`;
};

function researchSolution(s: GameState, techId: string, label: string): Solution | null {
  if (techDone(s, techId)) return null;
  const t = DATA.tech[techId];
  return {
    kind: 'research',
    icon: 'nav_research',
    label,
    detail: `研究「${t.name}」（${t.cost.toLocaleString()} RP）`,
    link: { screen: 'research', id: techId },
    disabled: techAvailable(s, techId) || s.research.current === techId ? undefined : '前提の研究がまだです',
  };
}

/** "sell what is not needed" with what it would bring in now */
function surplusSolution(s: GameState): Solution | null {
  if (!hasFeature(s, 'market')) return null;
  const plan = surplusPlan(s);
  const total = plan.reduce((t, l) => t + l.value, 0);
  return {
    kind: 'surplus',
    icon: 'fin_price',
    label: '余った在庫を売る',
    detail: plan.length ? `${plan.length}品目・約${yen(total)}（使う分は残す）` : '売れる余りがありません',
    command: { type: 'sellSurplus' },
    disabled: plan.length ? undefined : '売れる余りがありません（使う分は残しています）',
  };
}

function shortageProblems(s: GameState, out: Problem[]) {
  const p = DATA.balance.problems;
  const flows = plannedFlows(s);
  for (const [item, use] of Object.entries(flows.cons)) {
    if (use <= 1e-9) continue;
    const made = flows.prod[item] ?? 0;
    const deficit = use - made;
    if (deficit <= use * 0.02) continue;
    const stock = s.inventory[item] ?? 0;
    const days = stock / deficit;
    if (days >= p.stockYellowDays) continue;
    const it = DATA.item[item];
    const consumers = s.facilities.filter((f) => f.recipe && DATA.recipe[f.recipe].inputs[item] && f.rate > 0 && isProduction(defOf(f)));
    const fuelUsers = s.facilities.filter((f) => isPlant(f) && f.fuel === item && f.machines > 0);
    const users = [...consumers, ...fuelUsers];
    const level: Problem['level'] = days < p.stockRedDays ? 'red' : 'yellow';
    const impact = users.slice(0, 3).map((f) => (days < 0.05 ? `🏭 ${f.name} 停止中` : `🏭 ${f.name} ${days.toFixed(1)}日後に停止予測`));
    const solutions: Solution[] = [];
    if (hasFeature(s, 'market')) {
      const qty = Math.ceil(deficit * 7);
      const q = buyQuote(s, item, qty);
      solutions.push({
        kind: 'buy',
        icon: 'fin_buy',
        label: '市場で購入',
        detail: `${it.name} ${qtyText(qty, it.unit)}（7日分）約${yen(q.total)}`,
        command: { type: 'buy', item, qty },
        disabled: s.cash < q.total ? '資金が足りません' : undefined,
      });
    }
    if (hasFeature(s, 'contracts')) {
      const perDay = Math.ceil(deficit * 10) / 10;
      solutions.push({
        kind: 'contract',
        icon: 'fin_contract',
        label: '長期契約',
        detail: `毎日${qtyText(perDay, it.unit)}を30日間、約${yen(unitPrice(s, item) * (1 + DATA.balance.market.contractPremium))}/${it.unit}`,
        command: { type: 'contract', item, side: 'buy', perDay, days: 30 },
      });
    } else {
      const r = researchSolution(s, 'g_contract', '長期契約を結べるようにする');
      if (r) solutions.push(r);
    }
    const r = DATA.recipe[item];
    const fdef = DATA.facility[r.facility];
    const own = s.facilities.find((f) => f.type === fdef.id && f.recipe === item);
    if (own) {
      solutions.push({ kind: 'expand', icon: 'ui_construction', label: '生産を増やす', detail: `${own.name}に人・機械を足す`, link: { screen: 'facility', id: own.id } });
    }
    if (unlocked(s, fdef.unlock) && unlocked(s, r.unlock)) {
      solutions.push({
        kind: 'build',
        icon: fdef.id,
        label: `${fdef.name}を建設`,
        detail: `${yen(fdef.buildCost)}・${fdef.buildDays}日で${it.name}を自社生産`,
        link: { screen: 'build', id: fdef.id },
      });
    } else {
      const tech = DATA.tech[r.unlock] ? r.unlock : fdef.unlock;
      const rs = DATA.tech[tech] ? researchSolution(s, tech, `${it.name}の自社生産を研究`) : null;
      if (rs) solutions.push(rs);
    }
    if (consumers.length) {
      const top = consumers[0];
      solutions.push({ kind: 'reduce', icon: 'st_trend_down', label: '使う側を減産', detail: `${top.name}の生産を抑える`, link: { screen: 'facility', id: top.id } });
    }
    const save = researchSolution(s, 'm_saving', '省材料設計');
    if (save && hasFeature(s, 'research')) solutions.push(save);
    out.push({
      key: `short_${item}`,
      level,
      icon: item,
      title: `${it.name}不足`,
      detail: days < 0.05 ? `在庫がありません（不足 ${qtyText(deficit, it.unit)}/日）` : `残り${days.toFixed(1)}日（不足 ${qtyText(deficit, it.unit)}/日）`,
      impact,
      solutions,
    });
  }
}

function powerProblems(s: GameState, out: Problem[]) {
  const pw = s.power;
  if (pw.demand <= 0) return;
  const use = pw.supply > 0 ? pw.demand / pw.supply : Infinity;
  if (pw.ratio >= 0.999 && use < DATA.balance.problems.powerYellow) return;
  const red = pw.ratio < 0.999;
  const solutions: Solution[] = [];
  const contracts = DATA.balance.power.contracts;
  const cur = contracts.findIndex((c) => c.id === pw.contract);
  const next = contracts.slice(cur + 1).find((c) => contractAvailable(s, c.id) && c.capacity > pw.demand);
  const nextAny = contracts.slice(cur + 1).find((c) => contractAvailable(s, c.id));
  const pick = next ?? nextAny;
  if (pick) {
    solutions.push({
      kind: 'contract',
      icon: 'nav_power',
      label: `${pick.name}契約に変更`,
      detail: `容量${pick.capacity.toLocaleString()}kW・基本料金 月${yen(pick.capacity * pick.basicFee)}`,
      command: { type: 'setPowerContract', contract: pick.id },
    });
  } else {
    const nextLocked = contracts.slice(cur + 1).find((c) => !contractAvailable(s, c.id));
    if (nextLocked && DATA.tech[nextLocked.unlock]) {
      const rs = researchSolution(s, nextLocked.unlock, `${nextLocked.name}受電を研究`);
      if (rs) solutions.push(rs);
    }
  }
  if (unlocked(s, 'pw_plant')) {
    solutions.push({ kind: 'build', icon: 'power_plant', label: '発電所を建設', detail: '燃料を燃やして自社で発電', link: { screen: 'build', id: 'power_plant' } });
  } else {
    const rs = researchSolution(s, 'pw_plant', '火力発電を研究');
    if (rs && hasFeature(s, 'research')) solutions.push(rs);
  }
  solutions.push({ kind: 'eco', icon: 'misc_power_meter', label: '省電力で運転', detail: '電力画面で施設ごとの消費を見直す', link: { screen: 'power' } });
  const eco = researchSolution(s, 's_eco1', '省エネ設備');
  if (eco && hasFeature(s, 'research')) solutions.push(eco);
  out.push({
    key: 'power',
    level: red ? 'red' : 'yellow',
    icon: 'st_power_low',
    title: red ? '電力不足' : '電力逼迫',
    detail: `供給 ${Math.round(pw.supply).toLocaleString()}kW / 需要 ${Math.round(pw.demand).toLocaleString()}kW`,
    impact: red ? [`⚡ 工場効率 −${((1 - pw.ratio) * 100).toFixed(1)}%`] : [`使用率 ${(use * 100).toFixed(0)}%`],
    solutions,
  });
}

function staffProblems(s: GameState, out: Problem[]) {
  if (!hasFeature(s, 'hire')) return;
  const idle = s.employees.filter((e) => e.assignedTo === null && e.role !== 'manager' && e.role !== 'director');
  if (idle.length) {
    out.push({
      key: 'idle',
      level: 'yellow',
      icon: 'ppl_worker',
      title: `待機中の社員が${idle.length}人`,
      detail: '給与は払っているのに仕事がありません',
      impact: [`👥 月${yen(idle.reduce((t, e) => t + e.salary, 0))}の人件費`],
      solutions: [
        { kind: 'autoAssign', icon: 'misc_branch', label: '自動で配置', detail: '空きのある施設へ振り分ける', command: { type: 'autoAssign' } },
        { kind: 'staff', icon: 'nav_staff', label: '人材画面で配置', detail: '自分で選んで配置する', link: { screen: 'staff' } },
      ],
    });
  }
  const short: FacilityState[] = [];
  for (const f of s.facilities) {
    const def = defOf(f);
    if (!isProduction(def) && !isPlant(f) && f.type !== 'research_lab') continue;
    if (f.building && f.building.kind === 'build') continue;
    // a division head who hires fills these by the next morning
    const d = divisionFor(s, f);
    if (d && (d.hire || d.sub)) continue;
    const capN = staffCapacity(s, f);
    if (capN <= 0) continue;
    const have = employeesAt(s, f.id).length;
    if (f.stage !== 'manual' || f.type === 'research_lab' || isPlant(f)) {
      if (have < capN) short.push(f);
    } else if (have === 0 && f.level > 0) short.push(f);
  }
  if (short.length) {
    const machinesIdle = short.some((f) => f.stage === 'machine');
    const solutions: Solution[] = [];
    if (idle.length) solutions.push({ kind: 'autoAssign', icon: 'misc_branch', label: '待機社員を配置', detail: `${idle.length}人を自動配置`, command: { type: 'autoAssign' } });
    if (hasFeature(s, 'hire')) solutions.push({ kind: 'hire', icon: 'ppl_worker', label: '採用する', detail: `応募者${s.candidates.length}人`, link: { screen: 'staff' } });
    if (machinesIdle && hasFeature(s, 'auto')) {
      const f = short.find((x) => x.stage === 'machine')!;
      solutions.push({ kind: 'automate', icon: 'auto_robot', label: '自動化する', detail: `${f.name}を人の要らない自動機に`, link: { screen: 'facility', id: f.id } });
    } else if (machinesIdle) {
      const rs = researchSolution(s, 'a_auto', '自動制御を研究');
      if (rs && hasFeature(s, 'research')) solutions.push(rs);
    }
    out.push({
      key: 'staffShort',
      level: 'yellow',
      icon: 'st_staff_short',
      title: '人手不足',
      detail: `${short.length}施設で人が足りません`,
      impact: short.slice(0, 3).map((f) => `🏭 ${f.name} ${employeesAt(s, f.id).length}/${staffCapacity(s, f)}人`),
      solutions,
    });
  }
}

function storageProblem(s: GameState, out: Problem[]) {
  const cap = storageCapacity(s);
  const used = storedWeight(s);
  const ratio = cap > 0 ? used / cap : 1;
  if (ratio < DATA.balance.problems.storageYellow) return;
  const wh = s.facilities.find((f) => f.type === 'warehouse');
  const solutions: Solution[] = [
    { kind: 'sell', icon: 'nav_assets', label: '在庫を選んで売る', detail: '資産画面から重い在庫を売る', link: { screen: 'assets' } },
  ];
  const surplus = surplusSolution(s);
  if (surplus) solutions.unshift(surplus);
  if (hasFeature(s, 'build')) {
    solutions.splice(surplus ? 1 : 0, 0, { kind: 'build', icon: 'warehouse', label: '倉庫を建設', detail: `${yen(DATA.facility.warehouse.buildCost)}で+${(DATA.facility.warehouse.storage ?? 0).toLocaleString()}t`, link: { screen: 'build', id: 'warehouse' } });
  }
  if (wh && wh.level < DATA.facility.warehouse.maxLevel && !wh.building) {
    solutions.splice(solutions.length - 1, 0, { kind: 'expand', icon: 'ui_construction', label: '倉庫を拡張', detail: `${yen(levelUpCost(wh))}`, command: { type: 'upgradeLevel', facilityId: wh.id } });
  }
  solutions.push({ kind: 'reduce', icon: 'st_trend_down', label: '生産を調整', detail: '売れない物の生産を止める', link: { screen: 'production' } });
  out.push({
    key: 'storage',
    level: ratio >= 0.999 ? 'red' : 'yellow',
    icon: 'st_stock_low',
    title: ratio >= 0.999 ? '倉庫が満杯' : '倉庫が逼迫',
    detail: `${Math.round(used).toLocaleString()}t / ${Math.round(cap).toLocaleString()}t`,
    impact: ratio >= 0.999 ? ['📦 重さが増える生産が止まっています'] : [`使用率 ${(ratio * 100).toFixed(0)}%`],
    solutions,
  });
}

function logisticsProblem(s: GameState, out: Problem[]) {
  const l = s.logistics;
  if (l.load <= 0) return;
  const use = l.capacity > 0 ? l.load / l.capacity : Infinity;
  if (use < DATA.balance.problems.logisticsYellow) return;
  const need = Math.max(1, Math.ceil((l.load * 1.2 - l.capacity) / DATA.balance.logistics.truckCapacity));
  const solutions: Solution[] = [
    {
      kind: 'trucks',
      icon: 'vh_truck',
      label: `トラックを${need}台追加`,
      detail: `+${(need * DATA.balance.logistics.truckCapacity).toLocaleString()}t/日（在庫の小型トラックか市場で購入）`,
      command: { type: 'addTrucks', count: need },
    },
  ];
  if (unlocked(s, 'l_center')) solutions.push({ kind: 'build', icon: 'logistics_center', label: '物流センターを建設', detail: `+${(DATA.facility.logistics_center.logistics ?? 0).toLocaleString()}t/日・運賃−20%`, link: { screen: 'build', id: 'logistics_center' } });
  else {
    const rs = researchSolution(s, 'l_center', '物流センターを研究');
    if (rs && hasFeature(s, 'research')) solutions.push(rs);
  }
  out.push({
    key: 'logistics',
    level: use > 1.001 ? 'red' : 'yellow',
    icon: 'st_logistics_blocked',
    title: use > 1.001 ? '物流が追いつかない' : '物流逼迫',
    detail: `${Math.round(l.load).toLocaleString()}t/日 / 能力 ${Math.round(l.capacity).toLocaleString()}t/日`,
    impact:
      use > 1.001
        ? [
            `🚚 外部委託 ${Math.round(l.load - l.capacity).toLocaleString()}t/日（運賃${DATA.balance.logistics.outsourcePremium}倍）`,
            `⏱ 配送遅延で生産 −${((1 - l.ratio) * 100).toFixed(1)}%`,
          ]
        : [`使用率 ${(use * 100).toFixed(0)}%`],
    solutions,
  });
}

function cashProblem(s: GameState, out: Problem[]) {
  const profit = avgProfit(s, 7);
  const limit = loanLimit(s) - s.loan;
  if (s.cash < 0) {
    const want = Math.min(Math.max(0, limit), Math.ceil((-s.cash + Math.max(0, -profit) * 30) / 1e6) * 1e6);
    out.push({
      key: 'cash',
      level: 'red',
      icon: 'st_alert',
      title: '資金がマイナス',
      detail: `${yen(s.cash)}（当座貸越 年利${(DATA.balance.finance.overdraftRateYear * 100).toFixed(0)}%）`,
      impact: ['💰 高い利息がかかっています'],
      solutions: [
        { kind: 'borrow', icon: 'fin_bank', label: '銀行から借りる', detail: `${yen(want)}（年利${(DATA.balance.finance.loanRateYear * 100).toFixed(0)}%）`, command: { type: 'borrow', amount: want }, disabled: want <= 0 ? '借入枠がありません' : undefined },
        ...[surplusSolution(s)].filter((x): x is Solution => x !== null),
        { kind: 'sell', icon: 'nav_assets', label: '在庫を選んで売る', detail: '資産画面から売る', link: { screen: 'assets' } },
        { kind: 'cut', icon: 'st_trend_down', label: '赤字の施設を止める', detail: '財務画面で内訳を見る', link: { screen: 'finance' } },
      ],
    });
    return;
  }
  if (profit < 0) {
    const runway = s.cash / -profit;
    if (runway < DATA.balance.problems.cashRunwayYellowDays) {
      out.push({
        key: 'runway',
        level: 'yellow',
        icon: 'st_warning',
        title: `資金が約${Math.max(1, Math.floor(runway))}日で尽きます`,
        detail: `1日あたり ${yen(profit)}`,
        impact: ['💰 売上より費用が多い状態です'],
        solutions: [
          ...[surplusSolution(s)].filter((x): x is Solution => x !== null && !x.disabled),
          { kind: 'finance', icon: 'nav_finance', label: '収支を見る', detail: '何にお金がかかっているか', link: { screen: 'finance' } },
          { kind: 'borrow', icon: 'fin_bank', label: '借入', detail: `借入枠 ${yen(Math.max(0, limit))}`, link: { screen: 'finance' } },
        ],
      });
    }
  }
}

function lossProblems(s: GameState, out: Problem[]) {
  const n = DATA.balance.problems.lossDays;
  const losers = s.facilities.filter((f) => {
    const h = f.stats.profitHist;
    if (h.length < n || !f.recipe || inSubsidiary(s, f)) return false;
    let t = 0;
    for (let i = h.length - n; i < h.length; i++) t += h[i];
    return t < 0 && f.rate > 0;
  });
  if (!losers.length) return;
  const f = losers[0];
  const h = f.stats.profitHist;
  const avg = h.slice(-n).reduce((a, b) => a + b, 0) / n;
  const solutions: Solution[] = [{ kind: 'open', icon: 'ui_details', label: '施設を見る', detail: '内訳を確認する', link: { screen: 'facility', id: f.id } }];
  if (hasFeature(s, 'rules')) {
    solutions.unshift({
      kind: 'profit',
      icon: 'auto_target',
      label: '利益優先で自動運転',
      detail: '赤字のときは止める',
      command: { type: 'setAutomation', facilityId: f.id, settings: { ...f.auto, enabled: true, mode: 'easy', policy: 'profit' } },
    });
  }
  out.push({
    key: `loss_${f.id}`,
    level: 'yellow',
    icon: 'st_trend_down',
    title: `${f.name}が赤字`,
    detail: `${yen(avg)}/日（${n}日平均）${losers.length > 1 ? ` ほか${losers.length - 1}施設` : ''}`,
    impact: ['💰 材料・人件費・電気代が売上を上回っています'],
    solutions,
  });
}

function managementProblem(s: GameState, out: Problem[]) {
  const load = managementLoad(s);
  const cap = managementCapacity(s);
  if (load <= cap) return;
  const factor = managementFactor(s);
  const solutions: Solution[] = [];
  const hqNext = DATA.balance.hq[s.hq.level];
  if (hqNext && !s.hq.building) solutions.push({ kind: 'hq', icon: 'headquarters', label: `本社を「${hqNext.name}」へ`, detail: `${yen(hqNext.cost)}・管理能力${hqNext.management}`, command: { type: 'upgradeHQ' } });
  if (hasFeature(s, 'managers')) solutions.push({ kind: 'managers', icon: 'ppl_foreman', label: '工場長に任せる', detail: '工場長のいる施設は管理の負担が軽い', link: { screen: 'staff' } });
  else {
    const rs = researchSolution(s, 'a_managers', '工場長制度を研究');
    if (rs && hasFeature(s, 'research')) solutions.push(rs);
  }
  // the kind with the most facilities and no head yet
  const counts = new Map<string, number>();
  for (const f of s.facilities) if (isProduction(defOf(f)) && !divisionFor(s, f)) counts.set(f.type, (counts.get(f.type) ?? 0) + 1);
  const biggest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (hasFeature(s, 'divisions')) {
    if (biggest && biggest[1] >= 2) {
      solutions.push({ kind: 'division', icon: 'ppl_manager', label: '部門長に任せる', detail: `${DATA.facility[biggest[0]].short}の${biggest[1]}施設をまとめて運営（負担 ${DATA.balance.divisions.loadPerFacility}/施設）`, link: { screen: 'division', id: biggest[0] } });
    }
  } else if (hasFeature(s, 'managers')) {
    const rs = researchSolution(s, 'g_division', '部門制を研究');
    if (rs) solutions.push(rs);
  }
  if (hasFeature(s, 'subsidiaries')) {
    const big = Object.values(s.divisions).filter((d) => d.headId !== null && !d.sub).sort((a, b) => s.facilities.filter((f) => f.type === b.type).length - s.facilities.filter((f) => f.type === a.type).length)[0];
    if (big) solutions.push({ kind: 'subsidiary', icon: 'fin_merger', label: '子会社にする', detail: `${DATA.facility[big.type].short}部門を子会社に（本社の管理を使わない）`, link: { screen: 'division', id: big.type } });
  } else if (hasFeature(s, 'divisions')) {
    const rs = researchSolution(s, 'g_holding', '子会社を研究');
    if (rs) solutions.push(rs);
  }
  const org = researchSolution(s, 'g_org', '組織管理');
  if (org && hasFeature(s, 'managers')) solutions.push(org);
  out.push({
    key: 'management',
    level: factor < 0.9 ? 'red' : 'yellow',
    icon: 'nav_company',
    title: '管理が追いつかない',
    detail: `管理の負担 ${load.toFixed(1)} / 能力 ${cap.toFixed(1)}`,
    impact: [`🏢 全施設の効率 −${((1 - factor) * 100).toFixed(1)}%`],
    solutions,
  });
}

function researchProblem(s: GameState, out: Problem[]) {
  if (!hasFeature(s, 'research') || s.research.current) return;
  if (s.research.rpPerDay <= 0) return;
  if (!DATA.techs.some((t) => techAvailable(s, t.id))) return;
  out.push({
    key: 'research',
    level: 'yellow',
    icon: 'nav_research',
    title: '研究テーマが未設定',
    detail: `研究員が ${s.research.rpPerDay.toFixed(1)} RP/日 を無駄にしています`,
    impact: [],
    solutions: [{ kind: 'research', icon: 'nav_research', label: '研究を選ぶ', detail: '研究画面を開く', link: { screen: 'research' } }],
  });
}

const ORDER = ['cash', 'power', 'storage', 'logistics', 'short_', 'staffShort', 'management', 'idle', 'loss_', 'runway', 'research'];

export function detectProblems(s: GameState): Problem[] {
  const out: Problem[] = [];
  cashProblem(s, out);
  powerProblems(s, out);
  storageProblem(s, out);
  logisticsProblem(s, out);
  shortageProblems(s, out);
  staffProblems(s, out);
  managementProblem(s, out);
  lossProblems(s, out);
  researchProblem(s, out);
  const rank = (p: Problem) => {
    const i = ORDER.findIndex((k) => p.key === k || p.key.startsWith(k));
    return (p.level === 'red' ? 0 : 100) + (i < 0 ? 50 : i);
  };
  return out.sort((a, b) => rank(a) - rank(b));
}
