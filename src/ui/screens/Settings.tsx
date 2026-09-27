import { useRef, useState } from 'react';
import type { Settings as GameSettings } from '../../core';
import { dispatch, exportSave, useGame, useGameStore } from '../../store/game';
import { toast, useUI } from '../../store/ui';
import { Chips, Icon, Switch } from '../components';

function set<K extends keyof GameSettings>(key: K, value: GameSettings[K]) {
  dispatch({ type: 'setSetting', key, value });
}

export function Settings() {
  const v = useGame((s) => ({ ...s.settings, name: s.companyName, version: s.version }), [], 2);
  const openSheet = useUI((s) => s.openSheet);
  const [exported, setExported] = useState('');
  const [importText, setImportText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const doImport = async (text: string) => {
    const err = await useGameStore.getState().loadText(text.trim());
    if (err) toast(`読み込めませんでした：${err}`, 'bad');
    else {
      toast('セーブを読み込みました', 'good');
      setImportText('');
      useUI.getState().setTab('home');
    }
  };

  return (
    <>
      <div className="page-title">
        <Icon id="ui_settings" size={40} />
        <h1>設定</h1>
      </div>

      <div className="section-title">時間</div>
      <div className="card col" style={{ gap: 12 }}>
        <div className="spread">
          <div className="col" style={{ gap: 0 }}>
            <span className="bold small">大きな問題で自動停止</span>
            <span className="tiny dim">資金切れ・電力不足などで時間を止めます</span>
          </div>
          <Switch on={v.autoPause} onChange={(on) => set('autoPause', on)} label="自動停止" />
        </div>
        <div className="spread">
          <div className="col" style={{ gap: 0 }}>
            <span className="bold small">出来事（停電・ストライキなど）</span>
            <span className="tiny dim">ときどき選択を求められます。決めなければ最初の選択肢になります</span>
          </div>
          <Switch on={v.events} onChange={(on) => set('events', on)} label="出来事" />
        </div>
        <div className="col" style={{ gap: 6 }}>
          <span className="bold small">閉じている間の進行</span>
          <Chips
            value={String(v.offlineDays)}
            onChange={(x) => set('offlineDays', Number(x))}
            options={[
              ['0', '進めない'],
              ['7', '7日まで'],
              ['30', '30日まで'],
              ['90', '90日まで'],
            ]}
          />
          <span className="tiny dim">ゲーム内の日数（×1で1日＝1分）。自動停止する問題が起きたらそこで止まります。</span>
        </div>
      </div>

      <div className="section-title">表示</div>
      <div className="card col" style={{ gap: 12 }}>
        <div className="col" style={{ gap: 6 }}>
          <span className="bold small">テーマ</span>
          <Chips
            value={v.theme}
            onChange={(x) => set('theme', x)}
            options={[
              ['auto', '端末に合わせる'],
              ['light', 'ライト'],
              ['dark', 'ダーク'],
            ]}
          />
        </div>
        <div className="spread">
          <div className="col" style={{ gap: 0 }}>
            <span className="bold small">操作の案内</span>
            <span className="tiny dim">最初の目標のあいだ、次に押すボタンを光らせます</span>
          </div>
          <Switch on={v.guide} onChange={(on) => set('guide', on)} label="操作の案内" />
        </div>
        <div className="spread">
          <div className="col" style={{ gap: 0 }}>
            <span className="bold small">3Dの工業地帯</span>
            <span className="tiny dim">ホームに自社の施設を立体で表示（電池を少し使います）</span>
          </div>
          <Switch on={v.world3d} onChange={(on) => set('world3d', on)} label="3D表示" />
        </div>
        <div className="col" style={{ gap: 6 }}>
          <span className="bold small">自動運転の設定画面</span>
          <Chips
            value={v.automationLevel}
            onChange={(x) => set('automationLevel', x)}
            options={[
              ['easy', 'かんたん'],
              ['standard', '標準'],
              ['advanced', '上級'],
            ]}
          />
        </div>
      </div>

      <div className="section-title">セーブ</div>
      <div className="card col" style={{ gap: 10 }}>
        <p className="tiny dim">セーブはこの端末のブラウザに10秒ごとに保存されます。別の端末へ移すときは書き出して読み込んでください。</p>
        <div className="row">
          <button
            className="btn grow soft"
            onClick={() => {
              useGameStore.getState().runner?.flushSave();
              toast('保存しました', 'good');
            }}
          >
            今すぐ保存
          </button>
          <button className="btn grow soft" onClick={() => void exportSave().then(setExported)} data-testid="export">
            書き出す
          </button>
        </div>
        {exported && (
          <>
            <textarea className="input" readOnly value={exported} rows={4} onFocus={(e) => e.currentTarget.select()} aria-label="書き出したセーブ" />
            <div className="row">
              <button
                className="btn small grow"
                onClick={() => {
                  navigator.clipboard?.writeText(exported).then(
                    () => toast('コピーしました', 'good'),
                    () => toast('コピーできませんでした。長押しで選んでください', 'bad'),
                  );
                }}
              >
                コピー
              </button>
              <button
                className="btn small grow soft"
                onClick={() => {
                  const url = URL.createObjectURL(new Blob([exported], { type: 'text/plain' }));
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${v.name}.kogyo.txt`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                ファイルに保存
              </button>
            </div>
          </>
        )}
        <div className="divider" />
        <span className="bold small">読み込む</span>
        <textarea className="input" value={importText} onChange={(e) => setImportText(e.target.value)} rows={3} placeholder="KOGYO1: で始まる文字列を貼り付け" aria-label="読み込むセーブ" />
        <div className="row">
          <button
            className="btn small grow"
            disabled={!importText.trim()}
            onClick={() =>
              openSheet({
                kind: 'confirm',
                title: 'セーブを読み込みますか？',
                body: 'いまのゲームは読み込んだセーブで置き換わります。',
                ok: '読み込む',
                onOk: () => void doImport(importText),
              })
            }
          >
            読み込む
          </button>
          <button className="btn small grow soft" onClick={() => fileRef.current?.click()}>
            ファイルから
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,text/plain"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) setImportText(await file.text());
            }}
          />
        </div>
      </div>

      <div className="section-title">最初から</div>
      <div className="card col" style={{ gap: 8 }}>
        <p className="tiny dim">このゲームにリセットはありません。ここで消すと会社はすべて失われます。</p>
        <button
          className="btn danger block"
          onClick={() =>
            openSheet({
              kind: 'confirm',
              title: '会社を消して最初から始めますか？',
              body: `「${v.name}」のセーブを消します。元に戻せません。必要なら先に書き出してください。`,
              ok: '消して最初から',
              onOk: () => {
                useUI.setState({ tab: 'home', stack: [], sheet: null });
                useGameStore.getState().wipe();
              },
            })
          }
        >
          会社を消す
        </button>
      </div>
      <p className="tiny muted center" style={{ padding: '8px 0 4px' }}>
        工業ゲーム ・ セーブ形式 v{v.version} ・ 計算 {useGameStore.getState().runner?.kind === 'worker' ? '別スレッド' : '画面と同じスレッド'}
      </p>
    </>
  );
}
