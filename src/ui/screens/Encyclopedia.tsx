import { useState } from 'react';
import { DATA } from '../../data';
import { facilityUnlocked, visibleItems } from '../../core/visibility';
import { useGame } from '../../store/game';
import { useUI } from '../../store/ui';
import { Icon, Tabs } from '../components';

const ITEM_CAT: [string, string][] = [
  ['raw', '資源'],
  ['material', '素材'],
  ['part', '部品'],
  ['product', '製品'],
];

const FAC_CAT: [string, string][] = [
  ['extraction', '採取'],
  ['processing', '加工'],
  ['manufacturing', '製造'],
  ['infrastructure', '基盤'],
];

/** all 100 entries: 65 goods and 35 facilities, silhouettes until discovered */
export function Encyclopedia() {
  const [tab, setTab] = useState<'items' | 'facilities'>('items');
  const v = useGame(
    (s) => {
      const seen = visibleItems(s);
      return {
        items: DATA.items.filter((i) => seen.has(i.id)).map((i) => i.id),
        facilities: DATA.facilities.filter((f) => facilityUnlocked(s, f.id)).map((f) => f.id),
        owned: [...new Set(s.facilities.map((f) => f.type))],
      };
    },
    [],
    1,
  );
  const push = useUI((s) => s.push);
  const found = v.items.length + v.facilities.length;
  return (
    <>
      <div className="page-title">
        <Icon id="ui_book" size={40} />
        <h1>図鑑</h1>
        <span className="small muted">
          発見 {found}/{DATA.items.length + DATA.facilities.length}
        </span>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          ['items', `品目 ${v.items.length}/${DATA.items.length}`],
          ['facilities', `施設 ${v.facilities.length}/${DATA.facilities.length}`],
        ]}
      />
      {tab === 'items' &&
        ITEM_CAT.map(([cat, label]) => {
          const list = DATA.items.filter((i) => i.category === cat);
          return (
            <section key={cat} className="list">
              <div className="section-title">
                <span>{label}</span>
                <span className="small muted">
                  {list.filter((i) => v.items.includes(i.id)).length}/{list.length}
                </span>
              </div>
              <div className="dex">
                {list.map((i) => {
                  const known = v.items.includes(i.id);
                  return (
                    <button key={i.id} className={known ? '' : 'locked'} disabled={!known} onClick={() => push({ screen: 'item', id: i.id })} data-testid={`dex-${i.id}`}>
                      <span className="no">No.{i.no}</span>
                      <Icon id={i.id} size={48} locked={!known} />
                      <span>{known ? i.name : '？？？'}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      {tab === 'facilities' &&
        FAC_CAT.map(([cat, label]) => {
          const list = DATA.facilities.filter((f) => f.category === cat);
          return (
            <section key={cat} className="list">
              <div className="section-title">
                <span>{label}</span>
                <span className="small muted">
                  {list.filter((f) => v.facilities.includes(f.id)).length}/{list.length}
                </span>
              </div>
              <div className="dex">
                {list.map((f) => {
                  const known = v.facilities.includes(f.id);
                  return (
                    <button key={f.id} className={known ? '' : 'locked'} disabled={!known} onClick={() => push({ screen: 'build', id: f.id })}>
                      <span className="no">No.{f.no}</span>
                      <Icon id={f.id} size={48} locked={!known} />
                      <span>
                        {known ? f.short : '？？？'}
                        {v.owned.includes(f.id) ? ' ✓' : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
    </>
  );
}
