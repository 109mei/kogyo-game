import { DATA } from '../../data';
import { dateOf } from '../../core/calendar';
import { canBeDivision, divisionProfit, subsidiaryCost } from '../../core/divisions';
import { employeesAt } from '../../core/staff';
import { hasFeature } from '../../core/util';
import { dispatch, useGame } from '../../store/game';
import { useUI } from '../../store/ui';
import { Bar, Chips, Icon, Switch } from '../components';
import { stars, yen } from '../format';
import { facilityView } from '../selectors';
import { FacilityCard } from './Production';

const SHARES: [string, string][] = [
  ['0', 'なし'],
  ['0.25', '25%'],
  ['0.5', '50%'],
  ['1', '全部'],
];

/** every facility of one kind, run together by a division head (or a subsidiary) */
export function Division({ type }: { type: string }) {
  const def = DATA.facility[type];
  const v = useGame(
    (s) => {
      const d = s.divisions[type] ?? null;
      const list = s.facilities.filter((f) => f.type === type);
      const head = d?.headId != null ? (s.employees.find((e) => e.id === d.headId) ?? null) : null;
      const utils = list.map((f) => (f.stats.utilHist.length ? f.stats.utilHist[f.stats.utilHist.length - 1] : f.util));
      const leading = new Set(Object.values(s.divisions).map((x) => x.headId));
      return {
        unlocked: hasFeature(s, 'divisions'),
        subsOk: hasFeature(s, 'subsidiaries'),
        d: d ? { ...d, sub: d.sub ? { ...d.sub } : null } : null,
        head: head ? { id: head.id, name: head.name, skill: head.skill, salary: head.salary } : null,
        free: s.employees.filter((e) => e.role === 'director' && !leading.has(e.id)).map((e) => ({ id: e.id, name: e.name, skill: e.skill })),
        managers: s.employees.filter((e) => e.role === 'manager').map((e) => ({ id: e.id, name: e.name, skill: e.skill, at: e.assignedTo !== null })),
        facilities: list.map((f) => facilityView(s, f)),
        count: list.length,
        util: utils.length ? utils.reduce((t, x) => t + x, 0) / utils.length : 0,
        staff: list.reduce((t, f) => t + employeesAt(s, f.id).length, 0),
        profit: divisionProfit(s, type),
        subCost: subsidiaryCost(s, type),
        cash: s.cash,
      };
    },
    [type],
    3,
  );
  const openSheet = useUI((s) => s.openSheet);
  const push = useUI((s) => s.push);
  if (!def || !canBeDivision(type)) return <div className="card empty">部門にできない施設です</div>;
  const d = v.d;
  const sub = d?.sub ?? null;
  const bonus = v.head ? Math.round(DATA.balance.divisions.headBonusPerStar * v.head.skill * 100) : 0;
  const appoint = (employeeId: number) => dispatch({ type: 'setDivisionHead', facilityType: type, employeeId });
  const promoteAndAppoint = async (employeeId: number) => {
    const r = await dispatch({ type: 'promote', employeeId, role: 'director' });
    if (r.ok) await appoint(employeeId);
  };
  return (
    <>
      <div className="page-title">
        <Icon id={type} size={44} />
        <div className="col" style={{ gap: 0 }}>
          <h1>{sub ? sub.name : `${def.short}部門`}</h1>
          <span className="small dim">{sub ? `子会社・${def.name}` : `${def.name}をまとめて運営`}</span>
        </div>
      </div>

      <div className="tiles">
        <div className="tile">
          <span className="label">施設</span>
          <span className="value num">{v.count}</span>
        </div>
        <div className="tile">
          <span className="label">平均稼働率</span>
          <span className="value num">{Math.round(v.util * 100)}%</span>
          <Bar value={v.util} tone={v.util > 0.85 ? 'good' : v.util > 0.3 ? 'warn' : 'bad'} />
        </div>
        <div className="tile">
          <span className="label">利益（前日）</span>
          <span className={`value num ${v.profit >= 0 ? 'good' : 'bad'}`}>{yen(v.profit, { sign: true })}</span>
        </div>
        <div className="tile">
          <span className="label">人員</span>
          <span className="value num">{v.staff}人</span>
        </div>
      </div>

      {!v.unlocked ? (
        <div className="card col" style={{ gap: 8 }}>
          <p className="small">
            研究「部門制」を終えると、工場長を<b>部門長</b>に昇進させ、同じ種類の施設をまとめて任せられます。部門長は人の採用と配置、材料の調達と販売、機械の追加まで自分で行います。
          </p>
          <button className="btn soft block" onClick={() => push({ screen: 'research', id: 'g_division' })}>
            研究「部門制」を見る
          </button>
        </div>
      ) : (
        <>
          <div className="section-title">{sub ? '社長' : '部門長'}</div>
          <div className="card col" style={{ gap: 10 }} data-testid="division-head">
            {v.head ? (
              <div className="row">
                <Icon id="ppl_manager" size={48} />
                <div className="grow col" style={{ gap: 0 }}>
                  <span className="bold">{v.head.name}</span>
                  <span className="tiny dim">
                    <span className="warn">{stars(v.head.skill)}</span>・全施設の生産 +{bonus}%・{yen(v.head.salary)}/月
                  </span>
                </div>
                {!sub && (
                  <button className="btn small ghost" onClick={() => dispatch({ type: 'setDivisionHead', facilityType: type, employeeId: null })}>
                    外す
                  </button>
                )}
              </div>
            ) : (
              <p className="small dim">部門長がいません。任命すると、この部門の施設をまとめて運営します（管理の負担も1施設あたり{DATA.balance.divisions.loadPerFacility}に）。</p>
            )}
            {(!v.head || v.free.length > 0) && (
              <div className="col" style={{ gap: 6 }}>
                {v.free.map((e) => (
                  <button key={e.id} className="btn soft block" onClick={() => appoint(e.id)} data-testid="appoint-head">
                    {v.head ? '交代：' : ''}
                    {e.name}（部門長 {stars(e.skill)}）を任命
                  </button>
                ))}
                {!v.head &&
                  v.free.length === 0 &&
                  v.managers.map((e) => (
                    <button key={e.id} className="btn soft block" onClick={() => void promoteAndAppoint(e.id)} data-testid="promote-appoint">
                      工場長 {e.name}（{stars(e.skill)}）を部門長に昇進させて任命
                    </button>
                  ))}
                {!v.head && v.free.length === 0 && v.managers.length === 0 && (
                  <p className="tiny muted">部門長は工場長から昇進させます。熟練度★4の社員を工場長にしてください（人材画面）。</p>
                )}
              </div>
            )}
          </div>

          {v.head && d && (
            <>
              <div className="section-title">任せること</div>
              <div className="card col" style={{ gap: 12 }}>
                <div className="spread">
                  <div className="col" style={{ gap: 0 }}>
                    <span className="bold small">採用と配置</span>
                    <span className="tiny dim">空いた持ち場に人を置く。足りなければ採用する（人材会社は採用費×{DATA.balance.divisions.hireFeeMul}）</span>
                  </div>
                  <Switch on={d.hire || !!sub} onChange={(on) => dispatch({ type: 'setDivision', facilityType: type, hire: on })} label="採用と配置を任せる" />
                </div>
                <div className="col" style={{ gap: 6 }}>
                  <span className="bold small">利益のうち投資に回す割合</span>
                  <Chips value={String(d.invest)} onChange={(x) => dispatch({ type: 'setDivision', facilityType: type, invest: Number(x) })} options={SHARES} />
                  <span className="tiny dim">
                    忙しい施設への機械の追加・自動化・拡張{sub ? '・新しい工場の建設' : ''}に使います。現金が固定費の{DATA.balance.divisions.cashReserveDays}日分を割るときは使いません。
                  </span>
                </div>
                <div className="kv small">
                  <span>使える投資枠</span>
                  <span className="num">{yen(d.budget)}</span>
                  <span>これまでの投資</span>
                  <span className="num">{yen(d.spent)}</span>
                  <span>最近の判断</span>
                  <span>{d.last ?? '—'}</span>
                </div>
              </div>

              <div className="section-title">子会社</div>
              <div className="card col" style={{ gap: 10 }}>
                {sub ? (
                  <>
                    <div className="row">
                      <Icon id="fin_merger" size={44} />
                      <div className="grow col" style={{ gap: 0 }}>
                        <span className="bold">{sub.name}</span>
                        <span className="tiny dim">
                          {dateOf(sub.since).year}年{dateOf(sub.since).month}月設立・本社の管理を使わず、利益で自ら工場を増やします
                        </span>
                      </div>
                    </div>
                    <p className="tiny muted">子会社の施設や社員には、本社から直接の指示は出せません。</p>
                    <button
                      className="btn ghost block"
                      onClick={() =>
                        openSheet({
                          kind: 'confirm',
                          title: '本社の部門に戻しますか？',
                          body: `${sub.name}は本社の${def.short}部門に戻り、また本社の管理の負担になります。設立費は戻りません。`,
                          ok: '本社に戻す',
                          onOk: () => dispatch({ type: 'dissolveSubsidiary', facilityType: type }),
                        })
                      }
                    >
                      本社に戻す
                    </button>
                  </>
                ) : v.subsOk ? (
                  <>
                    <p className="small">
                      子会社にすると、この部門は本社の<b>管理の負担にならなくなり</b>、施設がいっぱいになれば新しい工場も自分で建てます。そのかわり、施設への直接の指示はできなくなります。
                    </p>
                    <button
                      className="btn block"
                      disabled={v.count < DATA.balance.divisions.minFacilities || v.cash < v.subCost}
                      onClick={() =>
                        openSheet({
                          kind: 'confirm',
                          title: `${def.short}部門を子会社にしますか？`,
                          body: `設立費 ${yen(v.subCost)}。${v.head?.name ?? '部門長'}さんが社長になります。あとで本社に戻せますが、設立費は戻りません。`,
                          ok: '子会社にする',
                          onOk: () => dispatch({ type: 'makeSubsidiary', facilityType: type }),
                        })
                      }
                      data-testid="make-subsidiary"
                    >
                      {v.count < DATA.balance.divisions.minFacilities ? `${DATA.balance.divisions.minFacilities}施設以上で子会社にできます` : `子会社にする（設立費 ${yen(v.subCost)}）`}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="small dim">研究「子会社」を終えると、部門を子会社として独り立ちさせられます。</p>
                    <button className="btn soft block" onClick={() => push({ screen: 'research', id: 'g_holding' })}>
                      研究「子会社」を見る
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </>
      )}

      <div className="section-title">施設</div>
      <div className="list">
        {v.facilities.map((f) => (
          <FacilityCard key={f.id} f={f} />
        ))}
        {v.facilities.length === 0 && <div className="card empty small">この種類の施設はまだありません</div>}
      </div>
    </>
  );
}
