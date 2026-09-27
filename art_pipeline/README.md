# 素材パイプライン

`素材置き場/` の白背景シート（2列×5段の100項目シート10枚、5列×2段のUIシート12枚）を、
ゲームで使う透過WebPアイコンに切り出します。

```bash
pip install pillow numpy scipy "rembg[cpu]"
python3 art_pipeline/cut_sheets.py            # 全220個を作り直す
python3 art_pipeline/cut_sheets.py --only log,paper
```

出力

- `public/assets/icons/<id>.webp` 長辺384px（詳細画面用）
- `public/assets/icons/sm/<id>.webp` 長辺128px（一覧用）
- `art_pipeline/review/` 明・暗・青の3背景で並べた確認用シート（git管理外）
- `art_pipeline/cut_report.json` 各アイコンの元シート・切り出し位置・手法

## 仕組み

1. `sheet_grid.py` がシートの行・列の切れ目を「いちばん白い線」に置く。長い方向は列（行）ごとに別々に探すので、上下にずれた絵が隣のセルへ入り込まない
2. 切れ目をまたぐ絵が欠けないよう、セルを12%広げて切り、中心が元のセル内にある塊だけを残す（`keep_own`）
3. 背景抜きは2通りを使い分ける（`sheets.json` の `methods`）
   - `u2net`（既定）：rembg の u2net で輪郭を取り、`matte.py` で白背景を前提に半透明部分を推定し直す。自転車の車輪やファンの格子の中に残る白いもやが消え、洗濯機など白い物は欠けない
   - `flood`（施設ジオラマ）：`flood_matte.py`。背景を縁から塗りつぶし、なだらかで薄い灰色の領域だけを半透明の黒い影に変える。石灰石鉱山・珪石鉱山のような白い地面を AI が背景扱いして消してしまう問題を避ける
   - `flood_noshadow`：影を焼き込まない flood（紙）
4. 隣の絵とほぼ接している2件（発電所・本社）は `margins` で広げ幅を0にしている

## ID一覧

`sheets.json` に、シートごとに左上から右へ、上の段から順の ID を書いている。
100項目は企画書の番号順（原料1〜15、中間素材16〜35、部品36〜50、完成品51〜65、施設66〜100）。
