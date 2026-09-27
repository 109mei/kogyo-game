import { useState } from 'react';
import { useGameStore } from '../../store/game';
import { Icon } from '../components';

const SUGGEST = ['みどり工業', 'あさひ産業', 'やまと製作所', 'ひかり工業', 'はやて産業', 'つばさ製作所'];

/** first launch (or a save that could not be read): name the company and start */
export function NewGame({ error }: { error: string | null }) {
  const [name, setName] = useState(() => SUGGEST[Math.floor(Math.random() * SUGGEST.length)]);
  const [showImport, setShowImport] = useState(false);
  const [text, setText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const start = () => useGameStore.getState().newGame(name.trim() || SUGGEST[0]);
  return (
    <div className="splash">
      <div className="hero" aria-hidden>
        <Icon id="log" size={52} />
        <Icon id="sawmill" size={68} />
        <Icon id="steel_mill" size={84} />
        <Icon id="electronics_factory" size={68} />
        <Icon id="smartphone" size={52} />
      </div>
      <div className="col" style={{ gap: 6 }}>
        <h1>工業ゲーム</h1>
        <p className="small dim">小さな手作業から、世界規模の産業企業へ。</p>
        <p className="small dim" style={{ marginTop: 6 }}>
          昨日まで自分でやっていた仕事が、
          <br />
          今日は自分なしで回っている。
        </p>
      </div>
      {error && (
        <div className="card banner bad" role="alert">
          セーブを読み込めませんでした：{error}
          <br />
          書き出したセーブがあれば下から読み込めます。
        </div>
      )}
      <div className="card col" style={{ gap: 10 }}>
        <div className="field">
          <label htmlFor="company-name">会社名</label>
          <input id="company-name" className="input" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && start()} data-testid="company-name" />
        </div>
        <button className="btn block" onClick={start} data-testid="start">
          会社をつくる
        </button>
        <button className="btn ghost block small" onClick={() => setShowImport(!showImport)}>
          書き出したセーブを読み込む
        </button>
        {showImport && (
          <>
            <textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="KOGYO1: で始まる文字列" aria-label="セーブ" />
            {importError && <p className="small bad">{importError}</p>}
            <button className="btn soft block" disabled={!text.trim()} onClick={() => void useGameStore.getState().loadText(text.trim()).then(setImportError)}>
              読み込む
            </button>
          </>
        )}
      </div>
      <p className="tiny muted">セーブはこの端末のブラウザに自動で保存されます</p>
    </div>
  );
}
