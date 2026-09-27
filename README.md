# 工業ゲーム

アイコン・テキスト・数字だけで、小さな手作業から世界規模の産業企業まで育てる、縦画面中心の超長期産業経営シミュレーション。

> 昨日まで自分でやっていた仕事が、今日は自分なしで回っている。

- 遊ぶ：https://109mei.github.io/kogyo-game/ （`main` へのpushで自動公開）
- 仕様：[docs/SPEC.md](docs/SPEC.md) ・ 採算表：[docs/ECONOMY.md](docs/ECONOMY.md)（`npm run econ` で再生成） ・ プレイテスト記録：[docs/PLAYTEST.md](docs/PLAYTEST.md)

## 遊び方

1. 生産タブで［原木を採取する］をタップ（10秒で1本）。3回集めると市場が開く
2. 市場で原木を売り、その他 → 人材 で応募者を雇って配置する。あなたがタップしなくても原木が増えていく
3. ホームの「次の目標」に沿って製材所・組立工場・研究所を建て、研究で機械化 → 自動化 → 運営ルールへ
4. 規模が大きくなると、人手 → 電力 → 物流 → 管理 と問題が移っていく。ホームの問題カードの［対処する］から解決策を選ぶ

時間は ⏸ ×1 ×4 ×12 ×48（×1で1日＝1分）。資金切れや電力不足などの重大な問題では自動で止まる。
閉じている間も会社は回り（設定で上限を選べる）、戻ったときに報告が出る。

## 開発

```bash
npm install
npm run dev         # http://localhost:5173/kogyo-game/
npm test            # ルール本体・セーブ・手触りの目安（Vitest）
npm run e2e         # 390x844 のスマホ画面でのブラウザテスト（Playwright）
npm run build       # 型チェック＋ビルド（dist/）
npm run balance -- 720 1        # 自動プレイヤーで720日遊ばせて進み具合を見る
npm run make-save -- 200 1      # 200日目のセーブを tools/out/ に作る（画面確認用）
npm run fuzz -- 45 500          # ランダムな命令を大量に送り、不変条件が破れないか調べる
```

ブラウザのコンソールでは `__kogyo.advance(240)` でゲーム内1日を進められる（時計と同じエンジンを回すだけ）。

### 構成

| 場所 | 中身 |
|---|---|
| `src/core` | ルール本体（状態・命令・固定刻みの進行・種つき乱数）。画面を一切知らない |
| `src/data` | 品目65・施設35・研究・目標・数値（JSON）と Zod の検査 |
| `src/save` | セーブの窓口（localStorage、版番号と移行、書き出し・読み込み、閉じていた間の計算） |
| `src/store` | 時計（Runner）と Zustand。画面は命令を渡すだけ |
| `src/ui` | React の画面。`src/ui/world` は Three.js の3D工業地帯（遅延読み込み） |
| `tests` / `e2e` | Vitest / Playwright |
| `tools` | 自動プレイヤー・バランス確認・採算表 |
| `art_pipeline` | 素材シートからアイコンを切り出す手順とスクリプト |

GitHub Pages の公開には、リポジトリの Settings → Pages → Source を「GitHub Actions」にしておく。
