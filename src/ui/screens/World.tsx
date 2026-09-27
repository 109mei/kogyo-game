import { DATA } from '../../data';
import { trend } from '../../core/market';
import { visibleItems } from '../../core/visibility';
import { useGame } from '../../store/game';
import { openLink, useUI } from '../../store/ui';
import { WorldSlot } from '../world/WorldSlot';
import { HBars, LineChart } from '../charts';
import { Icon } from '../components';
import { date, pct, signedPct } from '../format';

/** the company in the world: the economy, our share of each market, price moves and news */
export function World() {
  const v = useGame(
    (s) => {
      // the world price level: every market weighted by its size in yen
      let w = 0;
      let now = 0;
      const days = Math.min(...DATA.items.map((it) => s.market[it.id].hist.length));
      const series = new Array<number>(days).fill(0);
      for (const it of DATA.items) {
        const m = s.market[it.id];
        const weight = DATA.basePrice[it.id] * it.demand;
        w += weight;
        now += weight * m.index;
        for (let i = 0; i < days; i++) series[i] += weight * m.hist[m.hist.length - days + i];
      }
      const seen = visibleItems(s);
      const share = DATA.items
        .map((it) => ({ id: it.id, name: it.name, share: Math.max(0, s.market[it.id].flow) / it.demand }))
        .filter((x) => x.share > 0.001)
        .sort((a, b) => b.share - a.share)
        .slice(0, 8);
      const moves = DATA.items
        .filter((it) => seen.has(it.id))
        .map((it) => ({ id: it.id, name: it.name, change: trend(s, it.id, 7) }))
        .sort((a, b) => b.change - a.change);
      const today = Math.floor(s.tick / DATA.balance.time.ticksPerDay);
      return {
        level: now / w,
        series: series.map((x) => x / w),
        today,
        share,
        up: moves.slice(0, 3).filter((m) => m.change > 0.005),
        down: moves
          .slice(-3)
          .reverse()
          .filter((m) => m.change < -0.005),
        news: s.notices.filter((n) => n.icon === 'ev_price_surge' || n.icon === 'ev_recession').slice(-5).reverse(),
      };
    },
    [],
    1,
  );
  const push = useUI((s) => s.push);
  const mood = v.level > 1.05 ? '好況' : v.level < 0.95 ? '不況' : '平常';
  const n = v.series.length;
  return (
    <>
      <div className="page-title">
        <Icon id="ui_world" size={40} />
        <h1>世界</h1>
      </div>
      <WorldSlot tall />

      <div className="card col" style={{ gap: 10 }}>
        <div className="spread">
          <span className="bold">世界の景気</span>
          <span className="small">
            <b>{mood}</b>・物価 {Math.round(v.level * 100)}（基準100）
          </span>
        </div>
        <LineChart
          points={v.series.map((y, i) => ({ x: v.today - (n - 1 - i), y: y * 100 }))}
          format={(x) => x.toFixed(0)}
          xLabel={(x) => date(x, false)}
          label="世界の物価の推移"
        />
        <p className="tiny muted">全65品目の市場価格を市場規模で重みづけた平均。景気の波は品目ごとの需要の揺れから生まれます。</p>
      </div>

      <div className="card col" style={{ gap: 10 }}>
        <span className="bold">自社の市場シェア</span>
        {v.share.length ? (
          <>
            <HBars rows={v.share.map((x) => ({ label: x.name, value: x.share }))} format={(x) => pct(x, 1)} />
            <p className="tiny muted">1日の出荷量 ÷ 市場規模。シェアが大きいほど、自社の出荷で価格が下がります。</p>
          </>
        ) : (
          <span className="small dim">まだ市場に出荷していません</span>
        )}
      </div>

      {(v.up.length > 0 || v.down.length > 0) && (
        <div className="card col" style={{ gap: 6 }}>
          <span className="bold">今週の値動き</span>
          {[...v.up, ...v.down].map((m) => (
            <button key={m.id} className="row" style={{ border: 'none', background: 'none', padding: '4px 0', textAlign: 'left' }} onClick={() => push({ screen: 'marketItem', id: m.id })}>
              <Icon id={m.id} size={30} />
              <span className="grow small">{m.name}</span>
              <span className={`small num ${m.change > 0 ? 'good' : 'bad'}`}>{signedPct(m.change)}</span>
            </button>
          ))}
        </div>
      )}

      {v.news.length > 0 && (
        <div className="card col" style={{ gap: 4 }}>
          <span className="bold">世界のニュース</span>
          {v.news.map((n) => (
            <button key={n.id} className="row" style={{ border: 'none', background: 'none', padding: '4px 0', textAlign: 'left' }} onClick={() => openLink(n.link)}>
              <Icon id={n.icon} size={30} />
              <div className="grow col" style={{ gap: 0 }}>
                <span className="small bold">{n.title}</span>
                <span className="tiny dim">
                  {date(n.day, false)}・{n.body}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
