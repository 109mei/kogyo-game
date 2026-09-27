import { useState } from 'react';
import { DATA } from '../../data';
import type { AutomationSettings, Cond, CondVar, GameState, Policy, Rule } from '../../core';
import { dayIndex } from '../../core/calendar';
import { automateCost, capacity, defOf, facilityById, levelUpCost, levelUpDays, machinePrice, maxMachines } from '../../core/facilities';
import { mods } from '../../core/mods';
import { fuelAllowed, plantCapacity } from '../../core/power';
import { managerBonus } from '../../core/production';
import { SPECIALTY_NAME, employeesAt, staffCapacity } from '../../core/staff';
import { hasFeature } from '../../core/util';
import { recipeUnlocked } from '../../core/visibility';
import { dispatch, useGame } from '../../store/game';
import { toast, useUI } from '../../store/ui';
import { ColumnChart } from '../charts';
import { Bar, Icon, Radio, StagePill, Stepper, Switch, Tabs } from '../components';
import { date, kw, num, perDay, qty, stars, yen } from '../format';
import { coverage, facilityView, recipeMargin } from '../selectors';
import { TapButton } from './Production';

type TabId = 'overview' | 'production' | 'costs' | 'staff' | 'auto';

export function FacilityDetail({ id }: { id: number }) {
  const [tab, setTab] = useState<TabId>('overview');
  const def = useGame((s) => {
    const f = facilityById(s, id);
    return f ? defOf(f) : null;
  }, [id], 1);
  if (!def) return <div className="card empty">施設が見つかりません</div>;
  const production = def.category !== 'infrastructure';
  const plant = !!def.generator;
  const tabs: [TabId, string][] = production
    ? [
        ['overview', '概要'],
        ['production', '生産'],
        ['costs', '費用'],
        ['staff', '人員'],
        ['auto', '自動化'],
      ]
    : plant || def.id === 'research_lab'
      ? [
          ['overview', '概要'],
          ['production', plant ? '発電' : '設備'],
          ['staff', '人員'],
        ]
      : [
          ['overview', '概要'],
          ['production', '設備'],
        ];
  return (
    <>
      <Hero id={id} />
      <Tabs value={tab} onChange={setTab} options={tabs} />
      {tab === 'overview' && <Overview id={id} />}
      {tab === 'production' && <ProductionTab id={id} />}
      {tab === 'costs' && <Costs id={id} />}
      {tab === 'staff' && <StaffTab id={id} />}
      {tab === 'auto' && <AutoTab id={id} />}
    </>
  );
}

function Hero({ id }: { id: number }) {
  const v = useGame((s) => {
    const f = facilityById(s, id)!;
    return { f: facilityView(s, f), place: f.place, built: f.builtDay };
  }, [id]);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(v.f.name);
  const def = DATA.facility[v.f.type];
  return (
    <div className="card" style={{ paddingTop: 8 }}>
      <img src={`${import.meta.env.BASE_URL}assets/icons/${v.f.type}.webp`} alt="" style={{ width: '100%', height: 150, objectFit: 'contain', filter: 'var(--icon-shadow)' }} />
      {renaming ? (
        <div className="row" style={{ marginTop: 6 }}>
          <input className="input grow" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} aria-label="施設の名前" />
          <button
            className="btn small"
            onClick={() => {
              if (dispatch({ type: 'rename', facilityId: id, name }).ok) setRenaming(false);
            }}
          >
            保存
          </button>
        </div>
      ) : (
        <div className="spread" style={{ marginTop: 6 }}>
          <h1 style={{ fontSize: 20, fontWeight: 750 }}>{v.f.name}</h1>
          <button className="link" onClick={() => setRenaming(true)} aria-label="名前を変える">
            ✎
          </button>
        </div>
      )}
      <div className="row wrap small dim" style={{ marginTop: 2 }}>
        <span>{def.name}</span>
        <span>・{v.f.level === 0 ? '作業場' : `Lv${v.f.level}`}</span>
        {def.category !== 'infrastructure' && <StagePill stage={v.f.stage} machines={v.f.machines} />}
        <span>・{date(v.built)}建設</span>
      </div>
      <p className="small" style={{ marginTop: 6 }}>
        {v.f.status.text}
      </p>
      {v.f.building && (
        <div style={{ marginTop: 6 }}>
          <Bar value={v.f.building.progress} label="工事の進み具合" />
        </div>
      )}
      {v.f.stage === 'manual' && v.f.recipe && def.category !== 'infrastructure' && !(v.f.building && v.f.building.kind === 'build') && <TapButton f={v.f} />}
    </div>
  );
}

function Overview({ id }: { id: number }) {
  const [open, setOpen] = useState(false);
  const v = useGame((s) => {
    const f = facilityById(s, id)!;
    const def = defOf(f);
    const view = facilityView(s, f);
    const st = f.stats;
    const last = st.profitHist.length ? st.profitHist[st.profitHist.length - 1] : null;
    return {
      view,
      def,
      recipes: def.recipes.map((r) => ({ id: r, ok: recipeUnlocked(s, r) })),
      recipe: f.recipe,
      produced: Object.entries(st.produced).sort((a, b) => b[1] - a[1]),
      maxUtil: st.maxUtil,
      last,
      breakdown: { out: st.lastOut, wages: st.wages, upkeep: st.upkeep },
      lab: f.type === 'research_lab' ? { rp: s.research.rpPerDay, current: s.research.current } : null,
      storage: f.type === 'warehouse' ? (def.storage ?? 0) * f.level : null,
      logistics: f.type === 'logistics_center' ? (def.logistics ?? 0) * f.level : null,
    };
  }, [id]);
  const push = useUI((s) => s.push);
  const production = v.def.category !== 'infrastructure';
  return (
    <>
      {production && v.recipe && (
        <div className="card">
          <div className="spread">
            <span className="dim small">生産</span>
            <span className="bold num">{perDay(v.recipe, v.view.outPerDay)}</span>
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <span className="small dim" style={{ width: 48 }}>
              稼働率
            </span>
            <div className="grow">
              <Bar value={v.view.util} tone={v.view.util > 0.85 ? 'good' : v.view.util > 0.3 ? 'warn' : 'bad'} thick label="稼働率" />
            </div>
            <span className="num bold" style={{ width: 44, textAlign: 'right' }}>
              {Math.round(v.view.util * 100)}%
            </span>
          </div>
          <button className="spread" style={{ width: '100%', border: 'none', background: 'none', padding: '10px 0 0' }} onClick={() => setOpen(!open)} aria-expanded={open}>
            <span className="dim small">利益（前日）{open ? '▲' : '▼'}</span>
            <span className={`bold num ${v.last !== null && v.last < 0 ? 'bad' : 'good'}`}>{v.last === null ? '—' : `${yen(v.last, { sign: true })}/日`}</span>
          </button>
          {open && v.last !== null && (
            <div className="kv small" style={{ marginTop: 8 }}>
              <span>生産額</span>
              <span>{yen(v.breakdown.out)}</span>
              <span>材料・電力など</span>
              <span>−{yen(Math.max(0, v.breakdown.out - v.last - v.breakdown.wages - v.breakdown.upkeep))}</span>
              <span>人件費</span>
              <span>−{yen(v.breakdown.wages)}</span>
              <span>維持費</span>
              <span>−{yen(v.breakdown.upkeep)}</span>
              <span className="total">利益</span>
              <span className="total">{yen(v.last, { sign: true })}</span>
            </div>
          )}
        </div>
      )}

      {production && v.recipes.length > 1 && (
        <div className="card">
          <span className="small bold dim">作る物</span>
          <div className="chips" style={{ marginTop: 8 }}>
            {v.recipes.map((r) => (
              <button
                key={r.id}
                className={`chip${v.recipe === r.id ? ' on' : ''}`}
                disabled={!r.ok}
                onClick={() => r.id !== v.recipe && dispatch({ type: 'setRecipe', facilityId: id, recipe: r.id })}
              >
                <span className="row" style={{ gap: 4 }}>
                  <Icon id={r.id} size={18} />
                  {DATA.item[r.id].name}
                  {!r.ok && '🔒'}
                </span>
              </button>
            ))}
          </div>
          <p className="tiny muted" style={{ marginTop: 6 }}>
            作る物を変えると段取り替えに半日かかります。
          </p>
        </div>
      )}

      {v.lab && (
        <div className="card">
          <div className="kv">
            <span>研究の速さ（全研究所）</span>
            <span>{num(v.lab.rp, 1)} RP/日</span>
            <span>研究中</span>
            <span>{v.lab.current ? DATA.tech[v.lab.current].name : 'なし'}</span>
          </div>
          <button className="btn soft block" style={{ marginTop: 10 }} onClick={() => push({ screen: 'research' })}>
            研究画面へ
          </button>
        </div>
      )}
      {v.storage !== null && (
        <div className="card kv">
          <span>倉庫の容量</span>
          <span>{v.storage.toLocaleString()}t</span>
        </div>
      )}
      {v.logistics !== null && (
        <div className="card kv">
          <span>輸送能力</span>
          <span>{v.logistics.toLocaleString()}t/日</span>
        </div>
      )}

      <div className="card">
        <span className="small bold dim">この施設の歴史</span>
        <div className="kv small" style={{ marginTop: 8 }}>
          <span>最大稼働率</span>
          <span>{Math.round(v.maxUtil * 100)}%</span>
          {v.produced.slice(0, 4).map(([item, q]) => (
            <FragmentRow key={item} a={`累計生産（${DATA.item[item].name}）`} b={qty(item, q)} />
          ))}
        </div>
      </div>
      {v.recipe && production && (
        <button className="btn ghost block" onClick={() => push({ screen: 'item', id: v.recipe! })}>
          {DATA.item[v.recipe].name}のサプライチェーンを見る
        </button>
      )}
    </>
  );
}

function FragmentRow({ a, b }: { a: string; b: string }) {
  return (
    <>
      <span>{a}</span>
      <span>{b}</span>
    </>
  );
}

function stageNumbers(s: GameState, id: number) {
  const f = facilityById(s, id)!;
  const def = defOf(f);
  const r = f.recipe ? DATA.recipe[f.recipe] : null;
  const perBatch = r ? r.output / r.time : 0;
  const pm = r ? r.powerMul * mods(s).power : 1;
  return {
    manual: def.manualWorkers ? { out: perBatch, staff: 1, power: 0 } : null,
    machine: def.machine ? { out: def.machine.rate * perBatch, staff: def.machine.operators, power: def.machine.power * pm } : null,
    auto: def.auto ? { out: def.auto.rate * perBatch, staff: 0, power: def.auto.power * pm } : null,
  };
}

function ProductionTab({ id }: { id: number }) {
  const v = useGame((s) => {
    const f = facilityById(s, id)!;
    const def = defOf(f);
    const cap = capacity(s, f);
    const r = f.recipe ? DATA.recipe[f.recipe] : null;
    const bpd = r ? (cap.slots / r.time) * managerBonus(s, f) : 0;
    return {
      f: { ...f, building: f.building },
      def,
      cap,
      maxM: maxMachines(s, f),
      mPrice: machinePrice(f),
      autoCost: f.machines > 0 ? automateCost(f) : 0,
      lvCost: f.level < def.maxLevel ? levelUpCost(f) : null,
      lvDays: levelUpDays(f),
      cash: s.cash,
      machineOk: hasFeature(s, 'machine') || !def.manualWorkers,
      autoOk: hasFeature(s, 'auto'),
      stages: stageNumbers(s, id),
      io: r
        ? {
            out: { item: r.id, perDay: bpd * r.output },
            inputs: Object.entries(r.inputs).map(([i, q]) => ({ item: i, perDay: bpd * q * mods(s).inputs, cover: coverage(s, i) })),
          }
        : null,
      plant: def.generator
        ? {
            capacity: plantCapacity(s, f),
            units: f.machines,
            fuel: f.fuel ?? 'coal',
            fuels: Object.keys(def.generator.fuels).map((x) => ({ id: x, ok: fuelAllowed(s, x) })),
            stock: s.inventory[f.fuel ?? 'coal'] ?? 0,
            perDay: s.power.plantOutput * 24 * (def.generator.fuels[f.fuel ?? 'coal'] ?? 0) * mods(s).fuel,
          }
        : null,
    };
  }, [id]);
  const f = v.f;
  const def = v.def;
  const production = def.category !== 'infrastructure';
  const building = !!(f.building && f.building.kind === 'build');
  const buyLabel = f.stage === 'auto' ? '自動機を追加' : def.generator ? '発電機を追加' : '機械を追加';
  return (
    <>
      {production && (
        <div className="card">
          <span className="small bold dim">段階</span>
          <div className="col" style={{ gap: 6, marginTop: 8 }}>
            {(['manual', 'machine', 'auto'] as const).map((st) => {
              const n = v.stages[st];
              if (!n) return null;
              const cur = f.stage === st;
              const icon = st === 'manual' ? 'auto_worker' : st === 'machine' ? 'auto_machine' : 'auto_robot';
              return (
                <div key={st} className="row" style={{ padding: 8, borderRadius: 10, background: cur ? 'var(--accent-soft)' : 'var(--surface-2)' }}>
                  <Icon id={icon} size={36} />
                  <div className="grow col" style={{ gap: 0 }}>
                    <span className="bold small">
                      {st === 'manual' ? '手作業' : st === 'machine' ? '機械化' : '自動化'}
                      {cur && ' ← いまここ'}
                    </span>
                    <span className="tiny dim">
                      {f.recipe ? `${perDay(f.recipe, n.out)}` : ''}／{st === 'manual' ? '1人' : '1台'}・{n.staff === 0 ? '人員0' : `人員${n.staff}`}
                      {n.power > 0 && `・${kw(n.power)}`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(production || def.generator) && (
        <div className="card">
          <div className="kv">
            {f.stage === 'manual' && production ? (
              <>
                <span>作業員</span>
                <span>
                  {v.cap.staff}/{v.cap.staffNeeded}人
                </span>
              </>
            ) : (
              <>
                <span>{def.generator ? '発電機' : '機械'}</span>
                <span>
                  {f.machines}/{v.maxM}台
                </span>
                {f.stage === 'machine' && (
                  <>
                    <span>操作員</span>
                    <span>
                      {v.cap.staff}/{v.cap.staffNeeded || (def.generator ? f.machines * def.generator.operators : 0)}人
                    </span>
                  </>
                )}
                {v.cap.power > 0 && (
                  <>
                    <span>消費電力</span>
                    <span>{kw(v.cap.power)}</span>
                  </>
                )}
              </>
            )}
          </div>
          <div className="col" style={{ gap: 8, marginTop: 12 }}>
            {(def.machine || def.generator) && f.level > 0 && (
              <button
                className="btn block"
                disabled={building || !v.machineOk || f.machines >= v.maxM || v.cash < v.mPrice}
                onClick={() => dispatch({ type: 'buyMachine', facilityId: id })}
                data-testid="buy-machine"
              >
                {!v.machineOk ? '🔒 研究「機械化の基礎」で解放' : f.machines >= v.maxM ? `Lv${f.level}の上限です（拡張で増える）` : `⚙ ${buyLabel}`}
                {v.machineOk && f.machines < v.maxM && <span className="sub">{yen(v.mPrice)}</span>}
              </button>
            )}
            {production && f.stage === 'machine' && f.machines > 0 && (
              <button className="btn good block" disabled={!v.autoOk || v.cash < v.autoCost} onClick={() => dispatch({ type: 'automate', facilityId: id })}>
                {!v.autoOk ? '🔒 研究「自動制御」で自動化' : '🤖 自動化する（人が要らなくなる）'}
                {v.autoOk && <span className="sub">{yen(v.autoCost)}</span>}
              </button>
            )}
            {v.lvCost !== null && (
              <button className="btn soft block" disabled={!!f.building || v.cash < v.lvCost} onClick={() => dispatch({ type: 'upgradeLevel', facilityId: id })}>
                🏗 {f.level === 0 ? '施設として整備（Lv1）' : `拡張 Lv${f.level}→${f.level + 1}`}
                <span className="sub">
                  {yen(v.lvCost)}・{Math.ceil(v.lvDays)}日
                </span>
              </button>
            )}
            {f.level === 0 && <p className="tiny muted">作業場を整備すると人を多く置け、機械も入れられます。</p>}
          </div>
        </div>
      )}

      {!production && !def.generator && v.lvCost !== null && (
        <div className="card">
          <button className="btn soft block" disabled={!!f.building || v.cash < v.lvCost} onClick={() => dispatch({ type: 'upgradeLevel', facilityId: id })}>
            🏗 拡張 Lv{f.level}→{f.level + 1}
            <span className="sub">
              {yen(v.lvCost)}・{Math.ceil(v.lvDays)}日
            </span>
          </button>
        </div>
      )}

      {v.plant && (
        <div className="card">
          <div className="kv">
            <span>発電能力</span>
            <span>{kw(v.plant.capacity)}</span>
            <span>燃料の在庫</span>
            <span>{qty(v.plant.fuel, v.plant.stock)}</span>
            <span>燃料の消費</span>
            <span>{perDay(v.plant.fuel, v.plant.perDay)}</span>
          </div>
          <div className="chips" style={{ marginTop: 10 }}>
            {v.plant.fuels.map((x) => (
              <button key={x.id} className={`chip${v.plant!.fuel === x.id ? ' on' : ''}`} disabled={!x.ok} onClick={() => dispatch({ type: 'setFuel', facilityId: id, fuel: x.id })}>
                {DATA.item[x.id].name}
                {!x.ok && '🔒'}
              </button>
            ))}
          </div>
        </div>
      )}

      {v.io && (
        <div className="card">
          <span className="small bold dim">1日あたり（いまの人員・機械で）</span>
          <div className="col" style={{ gap: 6, marginTop: 8 }}>
            {v.io.inputs.map((i) => (
              <div key={i.item} className="row small">
                <Icon id={i.item} size={26} />
                <span className="grow">{DATA.item[i.item].name}</span>
                <span className="num">−{perDay(i.item, i.perDay)}</span>
                <span className={`tiny ${i.cover >= 0.8 ? 'good' : i.cover >= 0.4 ? 'warn' : 'bad'}`} style={{ width: 44, textAlign: 'right' }}>
                  {Math.round(i.cover * 100)}%
                </span>
              </div>
            ))}
            <div className="row small bold">
              <Icon id={v.io.out.item} size={26} />
              <span className="grow">{DATA.item[v.io.out.item].name}</span>
              <span className="num">+{perDay(v.io.out.item, v.io.out.perDay)}</span>
              <span style={{ width: 44 }} />
            </div>
          </div>
          {v.io.inputs.length > 0 && <p className="tiny muted" style={{ marginTop: 6 }}>％は材料の確保率（自社生産と在庫）</p>}
        </div>
      )}
    </>
  );
}

function Costs({ id }: { id: number }) {
  const v = useGame((s) => {
    const f = facilityById(s, id)!;
    const d = dayIndex(s.tick);
    return {
      hist: f.stats.profitHist.map((y, i, a) => ({ x: d - a.length + i, y })),
      margin: recipeMargin(s, f),
      wages: f.stats.wages,
      upkeep: f.stats.upkeep,
      out: f.stats.lastOut,
      recipe: f.recipe,
    };
  }, [id], 2);
  return (
    <>
      <div className="card">
        <span className="small bold dim">日ごとの利益（30日）</span>
        <div style={{ marginTop: 8 }}>
          <ColumnChart values={v.hist} format={(x) => yen(x, { unit: false })} xLabel={(x) => date(x, false)} label="日ごとの利益" />
        </div>
      </div>
      <div className="card kv">
        <span>生産額（前日）</span>
        <span>{yen(v.out)}</span>
        <span>人件費</span>
        <span>{yen(v.wages)}/日</span>
        <span>維持費</span>
        <span>{yen(v.upkeep)}/日</span>
        <span>いまの価格での利益率</span>
        <span className={v.margin >= 0 ? 'good' : 'bad'}>{Math.round(v.margin * 100)}%</span>
      </div>
    </>
  );
}

function StaffTab({ id }: { id: number }) {
  const v = useGame(
    (s) => {
      const f = facilityById(s, id)!;
      const mgr = f.managerId !== null ? s.employees.find((e) => e.id === f.managerId) : null;
      return {
        staff: employeesAt(s, id).map((e) => ({ ...e })),
        cap: staffCapacity(s, f),
        stage: f.stage,
        managers: hasFeature(s, 'managers') && defOf(f).category !== 'infrastructure',
        manager: mgr ? { ...mgr } : null,
        freeManagers: s.employees.filter((e) => e.role === 'manager' && e.assignedTo === null).map((e) => ({ ...e })),
        category: defOf(f).category,
      };
    },
    [id],
    4,
  );
  const openSheet = useUI((s) => s.openSheet);
  return (
    <>
      <div className="card">
        <div className="spread">
          <span className="bold">
            人員 {v.staff.length}/{v.cap}人
          </span>
          <button className="btn small" disabled={v.staff.length >= v.cap} onClick={() => openSheet({ kind: 'assign', facilityId: id })}>
            ＋ 配置
          </button>
        </div>
        {v.cap === 0 && <p className="small muted" style={{ marginTop: 6 }}>{v.stage === 'auto' ? '自動化した施設に人は要りません。' : 'いまは人を置けません。'}</p>}
        <div className="col" style={{ gap: 4, marginTop: 8 }}>
          {v.staff.map((e) => (
            <button key={e.id} className="row" style={{ border: 'none', background: 'none', padding: '6px 0', textAlign: 'left', width: '100%' }} onClick={() => openSheet({ kind: 'employee', id: e.id })}>
              <Icon id={e.role === 'researcher' ? 'ppl_researcher' : e.role === 'engineer' ? 'ppl_engineer' : 'ppl_worker'} size={34} />
              <div className="grow col" style={{ gap: 0 }}>
                <span className="bold small">{e.name}</span>
                <span className="tiny dim">
                  <span className="warn">{stars(e.skill)}</span> 得意 {SPECIALTY_NAME[e.specialty]}
                  {e.specialty === v.category && ' +12%'}
                </span>
              </div>
              <span className="tiny muted num">{yen(e.salary)}/月</span>
            </button>
          ))}
        </div>
      </div>
      {v.managers && (
        <div className="card">
          <span className="small bold dim">工場長</span>
          {v.manager ? (
            <div className="row" style={{ marginTop: 8 }}>
              <Icon id="ppl_foreman" size={40} />
              <div className="grow col" style={{ gap: 0 }}>
                <span className="bold">{v.manager.name}</span>
                <span className="tiny dim">
                  <span className="warn">{stars(v.manager.skill)}</span> 効率 +{Math.round(DATA.balance.staff.managerBonusPerStar * v.manager.skill * 100)}%・調達と販売を任せています
                </span>
              </div>
              <button className="btn small ghost" onClick={() => dispatch({ type: 'setManager', facilityId: id, employeeId: null })}>
                外す
              </button>
            </div>
          ) : v.freeManagers.length ? (
            <div className="col" style={{ gap: 6, marginTop: 8 }}>
              {v.freeManagers.map((m) => (
                <button key={m.id} className="btn soft block" onClick={() => dispatch({ type: 'setManager', facilityId: id, employeeId: m.id })}>
                  {m.name}（{stars(m.skill)}）を任命
                </button>
              ))}
            </div>
          ) : (
            <p className="small muted" style={{ marginTop: 6 }}>
              手の空いた工場長がいません。熟練度★4の作業員を昇進させるか、応募者から採用します。
            </p>
          )}
        </div>
      )}
    </>
  );
}

const VAR_LABEL: Record<CondVar, string> = {
  stock: '在庫',
  stockDays: '在庫日数',
  price: '市場価格(%)',
  demand: '需要(%)',
  margin: '利益率(%)',
  powerUse: '電力使用率(%)',
  powerPrice: '電力単価(円)',
  cash: '資金(円)',
};

function AutoTab({ id }: { id: number }) {
  const v = useGame(
    (s) => {
      const f = facilityById(s, id)!;
      return {
        auto: JSON.parse(JSON.stringify(f.auto)) as AutomationSettings,
        rules: hasFeature(s, 'rules'),
        advanced: hasFeature(s, 'advancedRules'),
        recipe: f.recipe,
        rate: f.rate,
        stock: f.recipe ? (s.inventory[f.recipe] ?? 0) : 0,
      };
    },
    [id],
    1,
  );
  const [a, setA] = useState<AutomationSettings>(v.auto);
  const push = useUI((s) => s.push);
  if (!v.rules) {
    return (
      <div className="card col" style={{ gap: 10 }}>
        <div className="row">
          <Icon id="auto_cycle" size={48} />
          <p className="small dim grow">研究「運営ルール」を終えると、在庫や電力に応じて施設を自動で動かせます。</p>
        </div>
        <button className="btn soft block" onClick={() => push({ screen: 'research', id: 'a_rules' })}>
          研究画面へ
        </button>
      </div>
    );
  }
  const item = v.recipe ? DATA.item[v.recipe] : null;
  const set = (p: Partial<AutomationSettings>) => setA({ ...a, ...p });
  const modes: [AutomationSettings['mode'], string][] = [
    ['easy', 'かんたん'],
    ['standard', '標準'],
  ];
  if (v.advanced) modes.push(['advanced', '上級']);
  return (
    <>
      <div className="card spread">
        <div className="col" style={{ gap: 0 }}>
          <span className="bold">🤖 自動運転</span>
          <span className="tiny dim">
            いま {Math.round(v.rate * 100)}% で運転中・在庫 {item ? qty(item.id, v.stock) : '—'}
          </span>
        </div>
        <Switch on={a.enabled} onChange={(on) => set({ enabled: on })} label="自動運転" />
      </div>
      <Tabs value={a.mode} onChange={(m) => set({ mode: m, policy: m === 'advanced' ? 'custom' : a.policy === 'custom' ? 'stable' : a.policy })} options={modes} />
      {a.mode === 'easy' && (
        <div className="card">
          <span className="small bold dim">運営方針</span>
          <div style={{ marginTop: 4 }}>
            {(
              [
                ['stable', '在庫安定', '目標の在庫を保つように動かす・止める'],
                ['profit', '利益優先', 'いまの価格で赤字なら止める'],
                ['max', '生産優先', 'いつも全力で動かす'],
                ['eco', '省電力', '会社の電力使用率が上限を超えたら半分に落とす'],
              ] as [Policy, string, string][]
            ).map(([p, label, hint]) => (
              <Radio key={p} on={a.policy === p} onClick={() => set({ policy: p })}>
                <span className="bold small">{label}</span>
                <br />
                <span className="tiny dim">{hint}</span>
              </Radio>
            ))}
          </div>
          {a.policy === 'stable' && item && (
            <div className="field" style={{ marginTop: 10 }}>
              <label>目標在庫（{item.unit}）</label>
              <Stepper value={a.targetStock} onChange={(x) => set({ targetStock: x })} step={Math.max(1, Math.round(a.targetStock / 10))} quick={[{ label: '+100', add: 100 }, { label: '+1,000', add: 1000 }, { label: '+10,000', add: 10000 }, { label: '0', set: 0 }]} />
            </div>
          )}
          {a.policy === 'eco' && (
            <div className="field" style={{ marginTop: 10 }}>
              <label>電力上限（%）</label>
              <Stepper value={Math.round(a.powerCap * 100)} onChange={(x) => set({ powerCap: x / 100 })} step={5} min={10} max={100} />
            </div>
          )}
        </div>
      )}
      {a.mode === 'standard' && item && (
        <div className="card col" style={{ gap: 10 }}>
          <p className="small dim">
            {item.name}の在庫が <b>{num(a.startBelow)}</b> 未満なら生産、<b>{num(a.stopAbove)}</b> を超えたら停止。電力使用率が上限を超えたら 50% で運転。
          </p>
          <div className="field">
            <label>この在庫より少なければ生産（{item.unit}）</label>
            <Stepper value={a.startBelow} onChange={(x) => set({ startBelow: x, stopAbove: Math.max(x, a.stopAbove) })} step={Math.max(1, Math.round(a.startBelow / 10))} quick={[{ label: '+100', add: 100 }, { label: '+1,000', add: 1000 }, { label: '+10,000', add: 10000 }, { label: '0', set: 0 }]} />
          </div>
          <div className="field">
            <label>この在庫を超えたら停止（{item.unit}）</label>
            <Stepper value={a.stopAbove} onChange={(x) => set({ stopAbove: Math.max(x, a.startBelow) })} step={Math.max(1, Math.round(a.stopAbove / 10))} quick={[{ label: '+100', add: 100 }, { label: '+1,000', add: 1000 }, { label: '+10,000', add: 10000 }, { label: '×2', set: a.stopAbove * 2 }]} />
          </div>
          <div className="field">
            <label>電力上限（%）</label>
            <Stepper value={Math.round(a.powerCap * 100)} onChange={(x) => set({ powerCap: x / 100 })} step={5} min={10} max={100} />
          </div>
        </div>
      )}
      {a.mode === 'advanced' && <RulesEditor rules={a.rules} onChange={(rules) => set({ rules })} />}
      <button
        className="btn block"
        onClick={() => {
          if (dispatch({ type: 'setAutomation', facilityId: id, settings: a }, { quiet: true }).ok) toast('自動運転の設定を保存しました', 'good');
        }}
        data-testid="save-automation"
      >
        保存
      </button>
    </>
  );
}

function RulesEditor({ rules, onChange }: { rules: Rule[]; onChange: (r: Rule[]) => void }) {
  const upd = (i: number, r: Rule) => onChange(rules.map((x, j) => (j === i ? r : x)));
  const blankCond: Cond = { v: 'stock', op: '<', value: 1000 };
  return (
    <div className="card col" style={{ gap: 10 }}>
      <p className="small dim">上から順に見て、条件がすべて当てはまった最初のルールの生産率で動きます。どれにも当てはまらなければ 100%。</p>
      {rules.map((r, i) => (
        <div key={i} className="rule">
          {r.conds.map((c, k) => (
            <div key={k} className="cond">
              <select className="input" value={c.v} aria-label="条件" onChange={(e) => upd(i, { ...r, conds: r.conds.map((x, j) => (j === k ? { ...x, v: e.target.value as CondVar } : x)) })}>
                {(Object.keys(VAR_LABEL) as CondVar[]).map((vv) => (
                  <option key={vv} value={vv}>
                    {VAR_LABEL[vv]}
                  </option>
                ))}
              </select>
              <select className="input" value={c.op} aria-label="比較" onChange={(e) => upd(i, { ...r, conds: r.conds.map((x, j) => (j === k ? { ...x, op: e.target.value as '<' | '>' } : x)) })}>
                <option value="<">&lt;</option>
                <option value=">">&gt;</option>
              </select>
              <input className="input" inputMode="decimal" aria-label="値" value={c.value} onChange={(e) => upd(i, { ...r, conds: r.conds.map((x, j) => (j === k ? { ...x, value: Number(e.target.value) || 0 } : x)) })} />
              <button className="link" aria-label="条件を消す" onClick={() => upd(i, { ...r, conds: r.conds.filter((_, j) => j !== k) })}>
                ✕
              </button>
            </div>
          ))}
          <div className="spread">
            <button className="link" onClick={() => upd(i, { ...r, conds: [...r.conds, { ...blankCond }] })}>
              ＋ AND条件
            </button>
            <div className="row small">
              <span>→ 生産率</span>
              <select className="input" style={{ width: 90, height: 34, padding: '0 6px' }} value={r.rate} aria-label="生産率" onChange={(e) => upd(i, { ...r, rate: Number(e.target.value) })}>
                {[0, 0.25, 0.5, 0.75, 1, 1.2, 1.5].map((x) => (
                  <option key={x} value={x}>
                    {Math.round(x * 100)}%
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button className="link" style={{ color: 'var(--bad-text)', alignSelf: 'flex-end' }} onClick={() => onChange(rules.filter((_, j) => j !== i))}>
            ルールを消す
          </button>
        </div>
      ))}
      <button className="btn ghost block" onClick={() => onChange([...rules, { conds: [{ ...blankCond }], rate: 1 }])}>
        ＋ ルールを追加
      </button>
      <p className="tiny muted">例：需要 &gt; 120 かつ 利益率 &gt; 15 かつ 電力単価 &lt; 18 → 生産率 120%</p>
    </div>
  );
}

