import { useEffect, useState } from 'react';
import { dispatch, useGame } from '../../store/game';
import { openLink } from '../../store/ui';
import { Chips, Icon } from '../components';
import { date } from '../format';

type Filter = 'all' | 'important' | 'good';

export function Notices() {
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(40);
  // what was unread when the screen opened stays marked while it is open
  const [unreadIds] = useState(() => new Set<number>());
  const v = useGame((s) => {
    for (const n of s.notices) if (!n.read) unreadIds.add(n.id);
    return [...s.notices].reverse().map((n) => ({ ...n }));
  }, [], 2);
  useEffect(() => {
    dispatch({ type: 'readNotices' }, { quiet: true });
  }, [v.length]);
  const list = v.filter((n) => (filter === 'important' ? n.level === 'bad' || n.level === 'warn' : filter === 'good' ? n.level === 'good' : true));
  return (
    <>
      <div className="page-title">
        <Icon id="ui_bell" size={40} />
        <h1>通知</h1>
      </div>
      <Chips
        value={filter}
        onChange={setFilter}
        options={[
          ['all', 'すべて'],
          ['important', '重要'],
          ['good', '良い知らせ'],
        ]}
      />
      <div className="card">
        {list.length === 0 && <div className="empty">通知はありません</div>}
        {list.slice(0, limit).map((n) => (
          <button key={n.id} className={`notice ${n.level}${unreadIds.has(n.id) ? ' unread' : ''}`} onClick={() => n.link && openLink(n.link)} data-testid="notice">
            <Icon id={n.icon} size={34} />
            <div className="col" style={{ gap: 1, minWidth: 0 }}>
              <span className="notice-title">{n.title}</span>
              {n.body && <span className="small dim">{n.body}</span>}
              <span className="tiny muted">
                {date(n.day, false)}
                {n.link ? ' ・ 開く ›' : ''}
              </span>
            </div>
          </button>
        ))}
      </div>
      {list.length > limit && (
        <button className="btn ghost block" onClick={() => setLimit(limit + 40)}>
          もっと見る（残り{list.length - limit}件）
        </button>
      )}
    </>
  );
}
