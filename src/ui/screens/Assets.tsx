import { useState } from 'react';
import { DATA } from '../../data';
import { storageCapacity, storedWeight } from '../../core/production';
import { dispatch, useGame } from '../../store/game';
import { useUI } from '../../store/ui';
import { Sparkline } from '../charts';
import { Bar, Chips, Icon } from '../components';
import { days, perDay, qty, yen } from '../format';
import { inventoryRows, type InvRow } from '../selectors';

type Sort = 'value' | 'short' | 'no';

export function Assets() {
  const [sort, setSort] = useState<Sort>('value');
  const v = useGame(
    (s) => ({
      rows: inventoryRows(s),
      cap: storageCapacity(s),
      used: storedWeight(s),
      compact: s.settings.compactInventory,
    }),
    [],
    4,
  );
  const rows = [...v.rows].sort((a, b) =>
    sort === 'value' ? b.value - a.value : sort === 'short' ? (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9) : DATA.item[a.item].no - DATA.item[b.item].no,
  );
  const ratio = v.cap > 0 ? v.used / v.cap : 1;
  return (
    <>
      <div className="page-title">
        <h1>資産</h1>
      </div>
      <div className="card">
        <div className="spread">
          <span className="row">
            <Icon id="warehouse" size={34} />
            <span className="bold">倉庫</span>
          </span>
          <span className="num small">
            {Math.round(v.used).toLocaleString()} / {Math.round(v.cap).toLocaleString()}t
          </span>
        </div>
        <div style={{ marginTop: 8 }}>
          <Bar value={ratio} tone={ratio >= 0.999 ? 'bad' : ratio > 0.9 ? 'warn' : 'good'} thick label="倉庫の使用率" />
        </div>
        <p className="tiny muted" style={{ marginTop: 6 }}>
          水・原油・天然ガスはタンクに入るので倉庫を使いません。
        </p>
      </div>
      <div className="spread">
        <Chips
          value={sort}
          onChange={setSort}
          options={[
            ['value', '金額順'],
            ['short', '不足順'],
            ['no', '番号順'],
          ]}
        />
        <button className="link" onClick={() => dispatch({ type: 'setSetting', key: 'compactInventory', value: !v.compact }, { quiet: true })}>
          {v.compact ? 'カード表示' : '一覧表示'}
        </button>
      </div>
      {rows.length === 0 && <div className="card empty">まだ在庫がありません。生産タブで原木を集めてみましょう。</div>}
      {v.compact ? (
        <div className="card flush">
          {rows.map((r) => (
            <CompactRow key={r.item} r={r} />
          ))}
        </div>
      ) : (
        <div className="list">
          {rows.map((r) => (
            <InvCard key={r.item} r={r} />
          ))}
        </div>
      )}
    </>
  );
}

function tone(r: InvRow): 'good' | 'warn' | 'bad' | '' {
  if (r.daysLeft !== null) return r.daysLeft < 3 ? 'bad' : r.daysLeft < 10 ? 'warn' : '';
  return r.net > 0 ? 'good' : '';
}

function InvCard({ r }: { r: InvRow }) {
  const push = useUI((s) => s.push);
  const it = DATA.item[r.item];
  const t = tone(r);
  return (
    <button className="card tap" style={{ border: 'none', textAlign: 'left' }} onClick={() => push({ screen: 'item', id: r.item })} data-testid={`inv-${r.item}`}>
      <div className="inv">
        <Icon id={r.item} size={52} />
        <div className="col" style={{ gap: 2, minWidth: 0 }}>
          <span className="bold">{it.name}</span>
          <span className="num" style={{ fontSize: 18, fontWeight: 700 }}>
            {qty(r.item, r.stock)}
          </span>
          <span className="tiny muted num">{yen(r.value)}</span>
        </div>
        <Sparkline values={r.stockHist.slice(-20)} />
      </div>
      <div className="flow" style={{ marginTop: 8 }}>
        <span>↑ 生産・購入</span>
        <span>{perDay(r.item, r.produced)}</span>
        <span>↓ 消費</span>
        <span>{perDay(r.item, r.consumed)}</span>
        <span>差引（販売後）</span>
        <span className={t === 'bad' ? 'bad' : t === 'good' ? 'good' : ''}>
          {t === 'bad' ? '🔴 ' : t === 'warn' ? '🟡 ' : t === 'good' ? '🟢 ' : ''}
          {perDay(r.item, r.net, { sign: true })}
        </span>
        {r.daysLeft !== null && (
          <>
            <span>在庫切れ予測</span>
            <span className={t === 'bad' ? 'bad' : 'warn'}>{days(r.daysLeft)}後</span>
          </>
        )}
      </div>
    </button>
  );
}

function CompactRow({ r }: { r: InvRow }) {
  const push = useUI((s) => s.push);
  const t = tone(r);
  return (
    <button className="inv-compact" style={{ width: '100%', background: 'none', border: 'none', borderBottom: '1px solid var(--hairline)', textAlign: 'left' }} onClick={() => push({ screen: 'item', id: r.item })}>
      <Icon id={r.item} size={28} />
      <span className="ellipsis">{DATA.item[r.item].name}</span>
      <span className="num">{qty(r.item, r.stock)}</span>
      <span className={`num small ${t === 'bad' ? 'bad' : t === 'good' ? 'good' : 'dim'}`} style={{ minWidth: 76, textAlign: 'right' }}>
        {t === 'bad' ? '🔴' : t === 'warn' ? '🟡' : '🟢'} {r.net >= 0 ? '+' : ''}
        {Math.abs(r.net) >= 100 ? Math.round(r.net).toLocaleString() : r.net.toFixed(1)}/日
      </span>
    </button>
  );
}
