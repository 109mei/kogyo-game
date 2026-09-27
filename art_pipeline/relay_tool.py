#!/usr/bin/env python3
"""relay_tool.py - ChatGPTで作った画像をゲーム素材にする後処理ツール
依存: Pillow, numpy（scipy があれば分割が速い）
  info    画像の状態（透過の有無・背景色・背景の均一さ・市松模様の疑い）を調べる
  cutout  背景を抜き、余白を切り、指定サイズのキャンバスに置く
  split   1枚に並んだアイコン等を1個ずつのPNGに分ける（cutout の後に使う）
  pixel   ドット絵の下絵を作る（縮小＋減色。仕上げは Aseprite）
  resize  背景画像などを指定サイズにする（抜きはしない）
  tile    タイル画像を3x3に並べて継ぎ目を確かめる画像を作る
  preview 市松・暗い背景・明るい背景に並べた確認用の一覧を作る
"""
import argparse, json
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

try:
    from scipy import ndimage as ndi
except Exception:
    ndi = None


def load(path):
    im = Image.open(path)
    im.load()
    had_alpha = im.mode in ("RGBA", "LA", "PA") or "transparency" in im.info
    return im.convert("RGBA"), had_alpha


def save_png(img, path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG")


def border(rgb, w=3):
    parts = [rgb[:w], rgb[-w:], rgb[:, :w].transpose(1, 0, 2), rgb[:, -w:].transpose(1, 0, 2)]
    return np.concatenate([p.reshape(-1, 3) for p in parts]).astype(np.float32)


def analyze(img, had_alpha):
    arr = np.asarray(img)
    a = arr[..., 3]
    transparent = float(np.mean(a == 0))
    real_alpha = had_alpha and transparent > 0.01
    b = border(arr[..., :3])
    bg = np.median(b, axis=0)
    uniform = float(np.mean(np.linalg.norm(b - bg, axis=1) < 30))
    sat = float(bg.max() - bg.min())
    lum = float(bg.mean())
    kind = "chroma" if sat >= 120 else ("white" if lum >= 200 else ("dark" if lum <= 50 else "other"))
    q = (b // 32).astype(int)
    _, counts = np.unique(q[:, 0] * 4096 + q[:, 1] * 64 + q[:, 2], return_counts=True)
    top2 = np.sort(counts)[::-1][:2].sum() / len(b)
    checker = bool(not real_alpha and uniform < 0.85 and top2 > 0.8 and len(counts) >= 2
                   and float(np.ptp(b, axis=1).mean()) < 20 and float(b.mean()) > 150)
    if real_alpha:
        mode = "alpha"
    elif uniform < 0.85:
        mode = "ng"
    else:
        mode = "global" if kind == "chroma" else "flood"
    return {
        "size": list(img.size), "alpha": real_alpha,
        "transparent": round(transparent, 3), "semi": round(float(np.mean((a > 0) & (a < 255))), 3),
        "bg": "#%02X%02X%02X" % tuple(int(v) for v in bg), "bg_kind": kind,
        "uniform": round(uniform, 3), "checker": checker, "mode": mode,
    }


def label(mask):
    if ndi is not None:
        lab, n = ndi.label(mask, structure=np.ones((3, 3), bool))
        return lab, n
    h, w = mask.shape
    m = mask.ravel()
    lab = np.zeros(h * w, np.int32)
    n = 0
    for start in np.flatnonzero(m):
        if lab[start]:
            continue
        n += 1
        lab[start] = n
        q = deque([start])
        while q:
            i = q.popleft()
            y, x = divmod(i, w)
            for yy in (y - 1, y, y + 1):
                if 0 <= yy < h:
                    for xx in (x - 1, x, x + 1):
                        if 0 <= xx < w:
                            j = yy * w + xx
                            if m[j] and not lab[j]:
                                lab[j] = n
                                q.append(j)
    return lab.reshape(h, w), n


def dilate(mask, r):
    if r <= 0:
        return mask
    if ndi is not None:
        return ndi.binary_dilation(mask, iterations=r)
    im = Image.fromarray(mask.astype(np.uint8) * 255)
    return np.asarray(im.filter(ImageFilter.MaxFilter(2 * r + 1))) > 0


def remove_specks(alpha, min_area):
    lab, n = label(alpha > 0)
    if n == 0:
        return alpha
    areas = np.bincount(lab.ravel())
    small = areas < min_area
    small[0] = False
    alpha[small[lab]] = 0
    return alpha


def cutout(img, had_alpha, mode="auto", tol=40.0, band=3, despill=True, spill_px=3, erode=0,
           min_alpha=8, min_area=24, force=False):
    info = analyze(img, had_alpha)
    arr = np.asarray(img).astype(np.float32)
    rgb, warns = arr[..., :3], []
    if mode == "auto":
        mode = info["mode"]
    if info["mode"] == "ng" and mode != "alpha":
        if info["checker"]:
            warns.append("市松模様が描き込まれている疑い。透明を頼まず単色背景で出し直す")
        msg = "背景が均一ではない（縁の一致率 %.0f%%）。単色背景で出し直すか、--force で強行" % (info["uniform"] * 100)
        if not force:
            raise SystemExit(json.dumps({"error": msg, "warnings": warns, **info}, ensure_ascii=False))
        warns.append(msg)
        if mode == "ng":
            mode = "global" if info["bg_kind"] == "chroma" else "flood"
    if mode == "alpha":
        a = arr[..., 3] / 255.0
        a[a >= 0.97] = 1.0
    else:
        bg = np.array([int(info["bg"][i:i + 2], 16) for i in (1, 3, 5)], np.float32)
        d = np.linalg.norm(rgb - bg, axis=2)
        core_bg = d <= tol
        if mode == "flood":
            lab, _ = label(core_bg)
            edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
            core_bg = np.isin(lab, edge[edge > 0])
            if info["bg_kind"] == "white":
                warns.append("白系の背景。白や淡い色の髪・服が一緒に抜けやすい。単色(#00FF00等)で出し直すのが確実")
        edge_band = dilate(core_bg, band) & ~core_bg
        a = np.where(core_bg, 0.0, 1.0).astype(np.float32)
        seed = ~(core_bg | edge_band)
        if edge_band.any():
            P = rgb[edge_band] - bg
            if ndi is not None and seed.any():
                iy, ix = ndi.distance_transform_edt(~seed, return_distances=False, return_indices=True)
                F = rgb[iy[edge_band], ix[edge_band]] - bg
                a[edge_band] = np.clip((P * F).sum(1) / np.maximum((F * F).sum(1), 1.0), 0.0, 1.0)
            else:
                a[edge_band] = np.clip((np.sqrt((P * P).sum(1)) - tol) / 60.0, 0.0, 1.0)
        a[a >= 0.97] = 1.0
        part = (a > 0) & (a < 1)
        aa = np.maximum(a[part], 0.15)[:, None]
        rgb[part] = (rgb[part] - (1 - aa) * bg) / aa
        hi = bg >= 128
        if despill and info["bg_kind"] == "chroma" and 1 <= hi.sum() <= 2:
            zone = dilate(a < 1, spill_px) & (a > 0)
            if hi.sum() == 1:
                c = int(np.argmax(hi))
                cap = rgb[..., ~hi].max(axis=2)
                rgb[..., c] = np.where(zone, np.minimum(rgb[..., c], cap), rgb[..., c])
            else:
                excess = np.maximum(rgb[..., hi].min(axis=2) - rgb[..., ~hi].max(axis=2), 0.0)
                for c in np.flatnonzero(hi):
                    rgb[..., c] = np.where(zone, rgb[..., c] - excess, rgb[..., c])
    a8 = np.round(np.clip(a, 0, 1) * 255).astype(np.uint8)
    a8[a8 < min_alpha] = 0
    if erode > 0:
        a8 = np.asarray(Image.fromarray(a8).filter(ImageFilter.MinFilter(2 * erode + 1))).copy()
    a8 = remove_specks(a8, min_area)
    lab, n = label(a8 > 0)
    if n > 1:
        areas = np.bincount(lab.ravel())[1:]
        tiny = int(np.sum(areas < areas.max() * 0.002))
        if tiny:
            warns.append("離れた小さな部品が %d 個（ゴミなら --min-area を上げる）" % tiny)
    out = np.dstack([np.clip(rgb, 0, 255).astype(np.uint8), a8])
    res = Image.fromarray(out, "RGBA")
    bbox = res.getchannel("A").getbbox()
    if bbox is None:
        raise SystemExit(json.dumps({"error": "全部透明になった。--tol を下げるか背景色を確認", **info}, ensure_ascii=False))
    w, h = res.size
    if bbox[0] == 0 or bbox[1] == 0 or bbox[2] == w or bbox[3] == h:
        warns.append("絵が画像の端に接している（切れている可能性）")
    return res.crop(bbox), {"mode": mode, "bbox": list(bbox), "warnings": warns, **{k: info[k] for k in ("bg", "bg_kind", "uniform")}}


def resize_rgba(img, size, resample=Image.LANCZOS):
    return img.convert("RGBa").resize(size, resample).convert("RGBA")


def place(img, size=None, pad=4, anchor="bottom", scale=None, height=None):
    w, h = img.size
    if height:
        scale = height / h
    if scale is None:
        scale = 1.0 if size is None else min((size[0] - 2 * pad) / w, (size[1] - 2 * pad) / h)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    W, H = size if size else (nw + 2 * pad, nh + 2 * pad)
    res = resize_rgba(img, (nw, nh)) if (nw, nh) != (w, h) else img
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    x = (W - nw) // 2
    y = H - pad - nh if anchor == "bottom" else (H - nh) // 2
    canvas.paste(res, (x, y))
    overflow = nw > W - 2 * pad or nh > H - 2 * pad
    return canvas, scale, overflow


def split(img, gap=12, min_area=64, pad=2, attach=0.6):
    arr = np.asarray(img)
    solid = arr[..., 3] > 0
    lab, _ = label(dilate(solid, gap))
    ys, xs = np.nonzero(solid)
    if len(ys) == 0:
        return []
    ls = lab[ys, xs]
    order = np.argsort(ls, kind="stable")
    ys, xs, ls = ys[order], xs[order], ls[order]
    starts = np.flatnonzero(np.r_[True, ls[1:] != ls[:-1]])
    comps = []
    for s, e in zip(starts, np.r_[starts[1:], len(ls)]):
        if e - s < min_area:
            continue
        y0, y1, x0, x1 = ys[s:e].min(), ys[s:e].max() + 1, xs[s:e].min(), xs[s:e].max() + 1
        m = np.zeros((y1 - y0, x1 - x0), bool)
        m[ys[s:e] - y0, xs[s:e] - x0] = True
        comps.append({"area": int(e - s), "box": [int(y0), int(y1), int(x0), int(x1)], "mask": m})
    if not comps:
        return []
    big = max(c["area"] for c in comps)
    majors = [c for c in comps if c["area"] >= 0.1 * big]
    minors = [c for c in comps if c["area"] < 0.1 * big]
    size = float(np.median([max(c["box"][1] - c["box"][0], c["box"][3] - c["box"][2]) for c in majors]))

    def gap_to(c, M):
        cy, cx = (c["box"][0] + c["box"][1]) / 2, (c["box"][2] + c["box"][3]) / 2
        y0, y1, x0, x1 = M["box"]
        return float(np.hypot(max(y0 - cy, 0, cy - y1), max(x0 - cx, 0, cx - x1)))

    def merge(M, c):
        a, b = M["box"], c["box"]
        box = [min(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), max(a[3], b[3])]
        m = np.zeros((box[1] - box[0], box[3] - box[2]), bool)
        for part in (M, c):
            y0, x0 = part["box"][0] - box[0], part["box"][2] - box[2]
            m[y0:y0 + part["mask"].shape[0], x0:x0 + part["mask"].shape[1]] |= part["mask"]
        M.update(box=box, mask=m, area=M["area"] + c["area"])

    for c in sorted(minors, key=lambda c: -c["area"]):
        best = min(majors, key=lambda M: gap_to(c, M))
        if gap_to(c, best) <= attach * size:
            merge(best, c)
        else:
            majors.append(c)
    med_h = float(np.median([c["box"][1] - c["box"][0] for c in majors]))
    majors.sort(key=lambda c: (c["box"][0] + c["box"][1]) / 2)
    rows, cur, cur_y = [], [], None
    for c in majors:
        cy = (c["box"][0] + c["box"][1]) / 2
        if cur and abs(cy - cur_y) > med_h / 2:
            rows.append(cur)
            cur = []
        if not cur:
            cur_y = cy
        cur.append(c)
    rows.append(cur)
    outs = []
    for row in rows:
        for c in sorted(row, key=lambda c: c["box"][2]):
            y0, y1, x0, x1 = c["box"]
            piece = arr[y0:y1, x0:x1].copy()
            piece[..., 3] = np.where(c["mask"], piece[..., 3], 0)
            im = Image.fromarray(piece, "RGBA")
            canvas = Image.new("RGBA", (im.width + 2 * pad, im.height + 2 * pad), (0, 0, 0, 0))
            canvas.paste(im, (pad, pad))
            outs.append(canvas)
    return outs


def pixel_draft(img, height=64, colors=16, alpha_cut=128):
    bbox = img.getchannel("A").getbbox()
    img = img.crop(bbox) if bbox else img
    nw = max(1, round(img.width * height / img.height))
    arr = np.asarray(resize_rgba(img, (nw, height), Image.BOX))
    opaque = arr[..., 3] >= alpha_cut
    if not opaque.any():
        raise SystemExit(json.dumps({"error": "不透明な画素がない"}, ensure_ascii=False))
    px = arr[..., :3][opaque].reshape(1, -1, 3).astype(np.uint8)
    pal = Image.fromarray(px, "RGB").quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    rgb = Image.fromarray(np.ascontiguousarray(arr[..., :3]), "RGB").quantize(palette=pal, dither=Image.Dither.NONE).convert("RGB")
    out = np.dstack([np.asarray(rgb), np.where(opaque, 255, 0).astype(np.uint8)])
    used = len(np.unique(np.asarray(rgb)[opaque].reshape(-1, 3), axis=0))
    return Image.fromarray(out, "RGBA"), used


def resize_cover(img, size, how="cover"):
    W, H = size
    if how == "stretch":
        return resize_rgba(img, (W, H))
    k = max(W / img.width, H / img.height)
    nw, nh = max(W, round(img.width * k)), max(H, round(img.height * k))
    big = resize_rgba(img, (nw, nh))
    x, y = (nw - W) // 2, (nh - H) // 2
    return big.crop((x, y, x + W, y + H))


def tile_preview(img, n=3):
    out = Image.new("RGBA", (img.width * n, img.height * n))
    for i in range(n):
        for j in range(n):
            out.paste(img, (i * img.width, j * img.height))
    return out


def checker_bg(w, h, s=8):
    yy, xx = np.mgrid[0:h, 0:w]
    v = np.where(((yy // s) + (xx // s)) % 2 == 0, 204, 255).astype(np.uint8)
    return Image.fromarray(np.dstack([v, v, v, np.full((h, w), 255, np.uint8)]), "RGBA")


def preview(paths, out, cell=256, per_sheet=12):
    grounds = [None, (32, 32, 32, 255), (240, 240, 240, 255)]
    written = []
    for s in range(0, len(paths), per_sheet):
        chunk = paths[s:s + per_sheet]
        sheet = Image.new("RGBA", (3 * (cell + 8) + 8, len(chunk) * (cell + 22) + 8), (255, 255, 255, 255))
        draw = ImageDraw.Draw(sheet)
        for r, p in enumerate(chunk):
            im = Image.open(p).convert("RGBA")
            if im.width <= cell and im.height <= cell:
                k = max(1, min(cell // im.width, cell // im.height))
                im = im.resize((im.width * k, im.height * k), Image.NEAREST)
            else:
                k = min(cell / im.width, cell / im.height)
                im = resize_rgba(im, (max(1, round(im.width * k)), max(1, round(im.height * k))))
            y = 8 + r * (cell + 22)
            draw.text((8, y), "%s  (%dx%d)" % (Path(p).name, *Image.open(p).size), fill=(0, 0, 0, 255))
            for c, g in enumerate(grounds):
                tile = checker_bg(cell, cell) if g is None else Image.new("RGBA", (cell, cell), g)
                tile.alpha_composite(im, ((cell - im.width) // 2, (cell - im.height) // 2))
                sheet.paste(tile, (8 + c * (cell + 8), y + 14))
        name = out if len(paths) <= per_sheet else str(Path(out).with_name("%s_%d.png" % (Path(out).stem, s // per_sheet + 1)))
        save_png(sheet.convert("RGB"), name)
        written.append(name)
    return written


def parse_size(t):
    w, h = t.lower().split("x")
    return int(w), int(h)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("info"); p.add_argument("inputs", nargs="+")
    p = sub.add_parser("cutout")
    p.add_argument("input"); p.add_argument("output")
    p.add_argument("--mode", default="auto", choices=["auto", "global", "flood", "alpha"])
    p.add_argument("--tol", type=float, default=40.0, help="背景色とみなす色の距離（背景が残るなら上げ、細部が消えるなら下げる）")
    p.add_argument("--band", type=int, default=3, help="背景との境目で半透明を計算する幅(px)")
    p.add_argument("--no-despill", action="store_true", help="境目の背景色のにじみ除去をしない")
    p.add_argument("--spill-px", type=int, default=3, help="にじみ除去をする幅(px)")
    p.add_argument("--erode", type=int, default=0, help="フチを内側へ削る画素数（灰色のフチ対策）")
    p.add_argument("--min-alpha", type=int, default=8, help="これ未満の不透明度を完全な透明にする（0-255。薄いフチを消すなら上げる）")
    p.add_argument("--min-area", type=int, default=24, help="これより小さい孤立したゴミを消す")
    p.add_argument("--fit", type=parse_size, help="キャンバスの大きさ 例 256x384。なければ絵の大きさ＋余白")
    p.add_argument("--height", type=int, help="絵の高さをこの画素数にする（キャラごとに身長を決めて揃える）")
    p.add_argument("--scale", type=float, help="倍率を固定する（同じシートから切り分けた部品の大きさを揃える）")
    p.add_argument("--pad", type=int, default=4)
    p.add_argument("--anchor", default="bottom", choices=["bottom", "center"], help="bottom=足元をそろえる、center=中央")
    p.add_argument("--force", action="store_true")
    p = sub.add_parser("split")
    p.add_argument("input"); p.add_argument("outdir")
    p.add_argument("--prefix", default="part_"); p.add_argument("--gap", type=int, default=12)
    p.add_argument("--min-area", type=int, default=64); p.add_argument("--pad", type=int, default=2)
    p.add_argument("--attach", type=float, default=0.6, help="小さな離れた部品（キラキラ等）を近くの本体にくっつける距離（本体の大きさに対する割合）")
    p = sub.add_parser("pixel")
    p.add_argument("input"); p.add_argument("output")
    p.add_argument("--height", type=int, default=64); p.add_argument("--colors", type=int, default=16)
    p.add_argument("--preview-scale", type=int, default=8)
    p = sub.add_parser("resize")
    p.add_argument("input"); p.add_argument("output"); p.add_argument("--size", type=parse_size, required=True)
    p.add_argument("--how", default="cover", choices=["cover", "stretch"], help="cover=はみ出しを中央で切る、stretch=引き伸ばす")
    p = sub.add_parser("tile")
    p.add_argument("input"); p.add_argument("output"); p.add_argument("--n", type=int, default=3)
    p = sub.add_parser("preview")
    p.add_argument("inputs", nargs="+"); p.add_argument("-o", "--output", required=True)
    p.add_argument("--cell", type=int, default=256)
    args = ap.parse_args()

    if args.cmd == "info":
        for f in args.inputs:
            img, had = load(f)
            print(json.dumps({"file": f, **analyze(img, had)}, ensure_ascii=False))
    elif args.cmd == "cutout":
        img, had = load(args.input)
        cut, rep = cutout(img, had, args.mode, args.tol, args.band, not args.no_despill, args.spill_px, args.erode,
                          args.min_alpha, args.min_area, args.force)
        rep["cut_size"] = list(cut.size)
        if args.fit or args.height or args.scale:
            cut, scale, over = place(cut, args.fit, args.pad, args.anchor, args.scale, args.height)
            rep["scale"] = round(scale, 5)
            if over:
                rep["warnings"].append("指定の高さ・倍率ではキャンバスからはみ出す")
        save_png(cut, args.output)
        print(json.dumps({"file": args.output, "size": list(cut.size), **rep}, ensure_ascii=False))
    elif args.cmd == "split":
        img, _ = load(args.input)
        outs = split(img, args.gap, args.min_area, args.pad, args.attach)
        names = []
        for i, im in enumerate(outs, 1):
            name = str(Path(args.outdir) / ("%s%02d.png" % (args.prefix, i)))
            save_png(im, name)
            names.append([name, list(im.size)])
        print(json.dumps({"count": len(outs), "files": names}, ensure_ascii=False))
    elif args.cmd == "pixel":
        img, _ = load(args.input)
        draft, used = pixel_draft(img, args.height, args.colors)
        save_png(draft, args.output)
        big = str(Path(args.output).with_name(Path(args.output).stem + "_x%d.png" % args.preview_scale))
        save_png(draft.resize((draft.width * args.preview_scale, draft.height * args.preview_scale), Image.NEAREST), big)
        print(json.dumps({"file": args.output, "preview": big, "size": list(draft.size), "colors": used}, ensure_ascii=False))
    elif args.cmd == "resize":
        img, _ = load(args.input)
        out = resize_cover(img, args.size, args.how)
        save_png(out, args.output)
        print(json.dumps({"file": args.output, "size": list(out.size), "from": list(img.size)}, ensure_ascii=False))
    elif args.cmd == "tile":
        img, _ = load(args.input)
        save_png(tile_preview(img, args.n), args.output)
        print(json.dumps({"file": args.output, "tile": list(img.size), "n": args.n}, ensure_ascii=False))
    elif args.cmd == "preview":
        print(json.dumps({"sheets": preview(args.inputs, args.output, args.cell)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
