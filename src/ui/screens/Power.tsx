import { DATA } from '../../data';
import { capacity, defOf } from '../../core/facilities';
import { contractAvailable, isPlant, plantCapacity } from '../../core/power';
import { unlocked } from '../../core/util';
import { dispatch, useGame } from '../../store/game';
import { useUI } from '../../store/ui';
import { SplitBar } from '../charts';
import { Bar, Icon } from '../components';
import { kw, yen } from '../format';

export function Power() {
  const v = useGame(
    (s) => {
      const p = s.power;
      const consumers = s.facilities
        .map((f) => ({ id: f.id, name: f.name, type: f.type, kw: defOf(f).category === 'infrastructure' ? 0 : capacity(s, f).power * Math.min(1, f.util || 0) }))
        .filter((x) => x.kw > 0)
        .sort((a, b) => b.kw - a.kw)
        .slice(0, 8);
      return {
        p: { ...p },
        machine: !!s.features.machine,
        contracts: DATA.balance.power.contracts.map((c) => ({ ...c, ok: contractAvailable(s, c.id) })),
        plants: s.facilities.filter(isPlant).map((f) => ({ id: f.id, name: f.name, cap: plantCapacity(s, f), fuel: f.fuel ?? 'coal', units: f.machines, stock: s.inventory[f.fuel ?? 'coal'] ?? 0 })),
        plantOpen: unlocked(s, 'pw_plant'),
        consumers,
      };
    },
    [],
    3,
  );
  const push = useUI((s) => s.push);
  const openSheet = useUI((s) => s.openSheet);
  const use = v.p.supply > 0 ? v.p.demand / v.p.supply : v.p.demand > 0 ? 1 : 0;
  const served = v.p.plantOutput + v.p.gridOutput;
  return (
    <>
      <div className="page-title">
        <Icon id="nav_power" size={40} />
        <h1>電力</h1>
      </div>
      {!v.machine && <div className="banner info">手作業の施設は電気を使いません。機械化すると電力が必要になります。</div>}
      <div className="card">
        <div className="spread">
          <span className="bold">{v.p.ratio < 0.999 ? '🔴 電力不足' : use > 0.9 ? '🟡 逼迫' : '🟢 安定'}</span>
          <span className="num small">
            需要 {kw(v.p.demand)} / 供給 {kw(v.p.supply)}
          </span>
        </div>
        <div style={{ marginTop: 8 }}>
          <Bar value={use} tone={v.p.ratio < 0.999 ? 'bad' : use > 0.9 ? 'warn' : 'good'} thick label="電力使用率" />
        </div>
        {v.p.ratio < 0.999 && <p className="small bad" style={{ marginTop: 6 }}>機械の効率が {Math.round(v.p.ratio * 100)}% に落ちています</p>}
        {served > 0 && v.plants.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <SplitBar
              total={served}
              parts={[
                { label: `自社発電 ${kw(v.p.plantOutput)}`, value: v.p.plantOutput, color: 'var(--series-1)' },
                { label: `系統 ${kw(v.p.gridOutput)}`, value: v.p.gridOutput, color: 'var(--series-2)' },
              ]}
            />
          </div>
        )}
      </div>

      <div className="section-title">電力会社との契約</div>
      <div className="list">
        {v.contracts.map((c) => {
          const cur = v.p.contract === c.id;
          return (
            <div key={c.id} className="card tight row" style={cur ? { boxShadow: 'inset 0 0 0 2px var(--accent)' } : undefined}>
              <div className="grow col" style={{ gap: 0 }}>
                <span className="bold">
                  {c.name}
                  {cur && '（契約中）'}
                </span>
                <span className="tiny dim">
                  {c.capacity ? `${kw(c.capacity)}・基本 ${yen(c.capacity * c.basicFee)}/月・${c.energyPrice}円/kWh` : '電気を使わない'}
                </span>
                {!c.ok && c.unlock !== 'start' && <span className="tiny muted">🔒 研究「{DATA.tech[c.unlock]?.name}」</span>}
              </div>
              {!cur && (
                <button
                  className="btn small soft"
                  disabled={!c.ok}
                  data-testid={`contract-${c.id}`}
                  onClick={() => {
                    const change = () => dispatch({ type: 'setPowerContract', contract: c.id });
                    // a smaller contract than the machines need stops the factory: ask first
                    if (c.capacity + v.p.plantCapacity < v.p.demand) {
                      openSheet({
                        kind: 'confirm',
                        title: `${c.name}に変えますか？`,
                        body: `いまの需要 ${kw(v.p.demand)} に対して、変更後の上限は ${kw(c.capacity + v.p.plantCapacity)} です。機械の効率が大きく落ちます。`,
                        ok: '変更する',
                        onOk: change,
                      });
                    } else change();
                  }}
                >
                  変更
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="section-title">自社の発電所</div>
      {v.plants.length === 0 ? (
        <div className="card col" style={{ gap: 8 }}>
          <p className="small dim">燃料を燃やして発電すると、大量に使うほど系統より安くなります。</p>
          <button className="btn soft block" disabled={!v.plantOpen} onClick={() => push({ screen: 'build', id: 'power_plant' })}>
            {v.plantOpen ? '発電所を建てる' : '🔒 研究「火力発電」'}
          </button>
        </div>
      ) : (
        v.plants.map((p) => (
          <button key={p.id} className="card tight tap row" style={{ border: 'none', textAlign: 'left' }} onClick={() => push({ screen: 'facility', id: p.id })}>
            <Icon id="power_plant" size={48} />
            <div className="grow col" style={{ gap: 0 }}>
              <span className="bold">{p.name}</span>
              <span className="tiny dim">
                {p.units}基・{kw(p.cap)}・燃料 {DATA.item[p.fuel].name} {Math.round(p.stock).toLocaleString()}
                {DATA.item[p.fuel].unit}
              </span>
            </div>
          </button>
        ))
      )}

      {v.consumers.length > 0 && (
        <>
          <div className="section-title">電気を多く使う施設</div>
          <div className="card">
            {v.consumers.map((c) => (
              <button key={c.id} className="row" style={{ width: '100%', border: 'none', background: 'none', padding: '6px 0', textAlign: 'left' }} onClick={() => push({ screen: 'facility', id: c.id })}>
                <Icon id={c.type} size={30} />
                <span className="grow small ellipsis">{c.name}</span>
                <span className="num small">{kw(c.kw)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
