import { useState } from 'react';
import { DATA } from '../../data';
import type { Ledger } from '../../core';
import { companyValue, loanLimit, netAssets, operatingProfit } from '../../core/finance';
import { dispatch, useGame } from '../../store/game';
import { ColumnChart, HBars, LineChart } from '../charts';
import { Icon, Stepper, Tabs } from '../components';
import { date, yen, yenShort } from '../format';

type Range = 'd30' | 'w120' | 'month';

const COST_ROWS: [keyof Ledger, string][] = [
  ['purchases', '仕入れ'],
  ['salaries', '人件費'],
  ['power', '電気代'],
  ['logistics', '運賃'],
  ['upkeep', '維持費'],
  ['interest', '利息'],
  ['other', 'その他'],
];

function sum(rows: Ledger[], k: keyof Ledger): number {
  let t = 0;
  for (const r of rows) t += r[k];
  return t;
}

export function Finance() {
  const [range, setRange] = useState<Range>('d30');
  const [amount, setAmount] = useState(1_000_000);
  const v = useGame(
    (s) => {
      const days = s.finance.days;
      const last30 = days.slice(-30);
      return {
        cash: s.cash,
        loan: s.loan,
        limit: loanLimit(s),
        net: netAssets(s),
        value: companyValue(s),
        days: days.map((d) => ({ day: d.day, profit: operatingProfit(d), cash: d.cash })),
        months: s.finance.months.map((m) => ({ year: m.year, month: m.month, sales: m.sales, profit: operatingProfit(m), cash: m.cash, capex: m.capex })),
        costs: COST_ROWS.map(([k, label]) => ({ label, value: sum(last30, k) })).filter((r) => r.value > 0),
        sales30: sum(last30, 'sales'),
        profit30: last30.reduce((t, d) => t + operatingProfit(d), 0),
        capex30: sum(last30, 'capex'),
        n30: last30.length,
        today: { ...s.finance.today },
      };
    },
    [],
    2,
  );
  const f = DATA.balance.finance;
  const room = Math.max(0, Math.floor(v.limit - v.loan));

  let columns: { x: number; y: number }[] = [];
  let colLabel: (x: number) => string = (x) => date(x, false);
  if (range === 'd30') columns = v.days.slice(-30).map((d) => ({ x: d.day, y: d.profit }));
  else if (range === 'w120') {
    const src = v.days.slice(-119);
    for (let i = 0; i < src.length; i += 7) {
      const wk = src.slice(i, i + 7);
      columns.push({ x: wk[0].day, y: wk.reduce((t, d) => t + d.profit, 0) });
    }
    colLabel = (x) => `${date(x, false)}〜`;
  } else {
    const ms = v.months.slice(-12);
    columns = ms.map((m, i) => ({ x: i, y: m.profit }));
    colLabel = (x) => (ms[x] ? `${ms[x].year}年${ms[x].month}月` : '');
  }

  return (
    <>
      <div className="page-title">
        <Icon id="nav_finance" size={40} />
        <h1>財務</h1>
      </div>
      <div className="tiles">
        <div className="tile">
          <span className="label">現金</span>
          <span className={`value num ${v.cash < 0 ? 'bad' : ''}`}>{yen(v.cash)}</span>
        </div>
        <div className="tile">
          <span className="label">借入</span>
          <span className="value num">{yen(v.loan)}</span>
        </div>
        <div className="tile">
          <span className="label">純資産</span>
          <span className="value num">{yen(v.net)}</span>
        </div>
        <div className="tile">
          <span className="label">企業価値</span>
          <span className="value num">{yen(v.value)}</span>
        </div>
      </div>

      <div className="card col" style={{ gap: 10 }}>
        <div className="spread">
          <span className="bold">営業利益</span>
          <Tabs
            value={range}
            onChange={setRange}
            options={[
              ['d30', '日別'],
              ['w120', '週別'],
              ['month', '月別'],
            ]}
          />
        </div>
        <ColumnChart values={columns} format={yenShort} xLabel={colLabel} label="営業利益の推移" />
        {v.n30 > 0 && (
          <div className="kv small">
            <span>直近{v.n30}日の売上</span>
            <span>{yen(v.sales30)}</span>
            <span>直近{v.n30}日の利益</span>
            <span className={v.profit30 < 0 ? 'bad' : 'good'}>{yen(v.profit30, { sign: true })}</span>
            <span>設備投資</span>
            <span>{yen(v.capex30)}</span>
          </div>
        )}
      </div>

      <div className="card col" style={{ gap: 10 }}>
        <span className="bold">現金の推移</span>
        <LineChart points={v.days.slice(-120).map((d) => ({ x: d.day, y: d.cash }))} format={yenShort} xLabel={(x) => date(x, false)} label="現金の推移" />
      </div>

      {v.costs.length > 0 && (
        <div className="card col" style={{ gap: 10 }}>
          <span className="bold">費用の内訳（直近{v.n30}日）</span>
          <HBars rows={v.costs.sort((a, b) => b.value - a.value)} format={yen} />
        </div>
      )}

      <div className="card col" style={{ gap: 8 }}>
        <div className="spread">
          <span className="bold">銀行</span>
          <span className="small dim">金利 年{(f.loanRateYear * 100).toFixed(1)}%</span>
        </div>
        <div className="kv small">
          <span>借入枠</span>
          <span>{yen(v.limit)}</span>
          <span>あと借りられる</span>
          <span>{yen(room)}</span>
          <span>利息</span>
          <span>{yen((v.loan * f.loanRateYear) / 365)}/日</span>
        </div>
        {v.cash < 0 && <p className="small bad">現金がマイナスです。当座貸越の金利は年{(f.overdraftRateYear * 100).toFixed(0)}%です。</p>}
        <Stepper
          value={amount}
          onChange={setAmount}
          step={100_000}
          quick={[
            { label: '+100万', add: 1_000_000 },
            { label: '+1,000万', add: 10_000_000 },
            { label: '+1億', add: 100_000_000 },
            { label: '枠いっぱい', set: room },
          ]}
          unit="円"
        />
        <div className="row">
          <button className="btn grow" disabled={room <= 0 || amount <= 0} onClick={() => dispatch({ type: 'borrow', amount })} data-testid="borrow">
            借りる
          </button>
          <button className="btn grow soft" disabled={v.loan <= 0 || amount <= 0 || v.cash <= 0} onClick={() => dispatch({ type: 'repay', amount })}>
            返す
          </button>
          <button className="btn ghost" disabled={v.loan <= 0 || v.cash <= 0} onClick={() => dispatch({ type: 'repay', amount: v.loan })}>
            全額
          </button>
        </div>
      </div>

      {v.months.length > 0 && (
        <div className="card">
          <span className="bold">月次決算</span>
          <table className="table" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>月</th>
                <th>売上</th>
                <th>利益</th>
                <th>現金</th>
              </tr>
            </thead>
            <tbody>
              {v.months
                .slice(-12)
                .reverse()
                .map((m) => (
                  <tr key={`${m.year}-${m.month}`}>
                    <td>
                      {m.year}/{m.month}
                    </td>
                    <td className="num">{yenShort(m.sales)}</td>
                    <td className={`num ${m.profit < 0 ? 'bad' : ''}`}>{yenShort(m.profit)}</td>
                    <td className="num">{yenShort(m.cash)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
