import { useEffect } from 'react';
import { DATA } from '../../data';
import { unlocked } from '../../core/util';
import { useGame } from '../../store/game';
import { useUI } from '../../store/ui';
import { Icon, Section } from '../components';
import { yen } from '../format';

const CATS = [
  ['extraction', '採取'],
  ['processing', '加工'],
  ['manufacturing', '製造'],
  ['infrastructure', '経営・インフラ'],
] as const;

export function Build({ focus }: { focus?: string }) {
  const v = useGame(
    (s) => ({
      cash: s.cash,
      open: Object.fromEntries(DATA.facilities.map((f) => [f.id, unlocked(s, f.unlock)])),
      owned: Object.fromEntries(DATA.facilities.map((f) => [f.id, s.facilities.filter((x) => x.type === f.id).length])),
      canBuild: !!s.features.build,
    }),
    [],
    2,
  );
  const openSheet = useUI((s) => s.openSheet);
  useEffect(() => {
    if (focus && DATA.facility[focus] && focus !== 'headquarters') openSheet({ kind: 'build', facility: focus });
  }, [focus, openSheet]);
  return (
    <>
      <div className="page-title">
        <h1>施設を建設</h1>
      </div>
      {!v.canBuild && <div className="banner info">「社員を3人にしよう」を達成すると建設できるようになります。</div>}
      {CATS.map(([cat, label]) => (
        <Section key={cat} title={label}>
          <div className="list">
            {DATA.facilities
              .filter((f) => f.category === cat && f.id !== 'headquarters')
              .sort((a, b) => Number(v.open[b.id]) - Number(v.open[a.id]) || a.buildCost - b.buildCost)
              .map((f) => {
                const open = v.open[f.id];
                const need = !open && DATA.tech[f.unlock] ? DATA.tech[f.unlock].name : null;
                return (
                  <button
                    key={f.id}
                    className="card tight tap"
                    style={{ border: 'none', textAlign: 'left', opacity: open ? 1 : 0.7 }}
                    onClick={() => open && openSheet({ kind: 'build', facility: f.id })}
                    data-testid={`build-${f.id}`}
                  >
                    <div className="row">
                      <Icon id={f.id} size={64} locked={!open} />
                      <div className="grow col" style={{ gap: 2 }}>
                        <div className="spread">
                          <span className="bold">{f.name}</span>
                          {v.owned[f.id] > 0 && <span className="pill">所有 {v.owned[f.id]}</span>}
                        </div>
                        {open ? (
                          <>
                            <span className={`small num ${v.cash < f.buildCost ? 'bad' : 'dim'}`}>
                              {yen(f.buildCost)}・{f.buildDays}日
                            </span>
                            {f.recipes.length > 0 && (
                              <div className="row" style={{ gap: 2 }}>
                                {f.recipes.slice(0, 8).map((r) => (
                                  <Icon key={r} id={r} size={22} />
                                ))}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="small muted">🔒 研究「{need}」で解放</span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
          </div>
        </Section>
      ))}
    </>
  );
}
