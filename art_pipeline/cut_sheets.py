#!/usr/bin/env python3
"""Cut the white-background sprite sheets in 素材置き場/ into game icons.

  python3 art_pipeline/cut_sheets.py            # all sheets
  python3 art_pipeline/cut_sheets.py --only log,paper

Writes public/assets/icons/<id>.webp (long side 384) and
public/assets/icons/sm/<id>.webp (long side 128), plus a review PNG per sheet
in art_pipeline/review/. Requires: pillow numpy scipy rembg[cpu].
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from rembg import new_session, remove

from flood_matte import flood_matte
from matte import refine
from sheet_grid import grid_boxes

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "素材置き場"
OUT = ROOT / "public" / "assets" / "icons"
REVIEW = Path(__file__).resolve().parent / "review"
SIZES = {"": 384, "sm": 128}
PAD_FRAC = 0.04


def keep_own(rgba, own_box):
    """Keep only blobs whose centre lies inside the original cell.

    Cells are cropped with a margin so objects that cross a cut line stay
    whole; parts of neighbouring objects that come in with the margin are
    dropped here.
    """
    a = rgba[..., 3]
    # label solid pixels only: translucent ground shadows would otherwise glue
    # a neighbour's base to this object
    lab, n = ndi.label(a > 150, structure=np.ones((3, 3), bool))
    if n == 0:
        return rgba
    x0, y0, x1, y1 = own_box
    keep = np.zeros(n + 1, bool)
    for i, sl in enumerate(ndi.find_objects(lab), start=1):
        ys, xs = np.nonzero(lab[sl] == i)
        cy, cx = ys.mean() + sl[0].start, xs.mean() + sl[1].start
        keep[i] = x0 <= cx < x1 and y0 <= cy < y1
    core = keep[lab]
    zone = ndi.binary_dilation(core, iterations=10)
    out = rgba.copy()
    out[..., 3] = np.where(zone, a, 0)
    return out


def expand(box, img_size, frac=0.12):
    x0, y0, x1, y1 = box
    mx, my = int((x1 - x0) * frac), int((y1 - y0) * frac)
    W, H = img_size
    big = (max(0, x0 - mx), max(0, y0 - my), min(W, x1 + mx), min(H, y1 + my))
    own = (x0 - big[0], y0 - big[1], x1 - big[0], y1 - big[1])
    return big, own


def fit(im, long_side):
    w, h = im.size
    pad = max(2, round(long_side * PAD_FRAC))
    k = (long_side - 2 * pad) / max(w, h)
    nw, nh = max(1, round(w * k)), max(1, round(h * k))
    # resize in premultiplied space so edges do not pick up dark fringes
    res = im.convert("RGBa").resize((nw, nh), Image.LANCZOS).convert("RGBA")
    canvas = Image.new("RGBA", (nw + 2 * pad, nh + 2 * pad), (0, 0, 0, 0))
    canvas.paste(res, (pad, pad))
    return canvas


def review_sheet(icons, path, cell=180):
    grounds = [(250, 250, 248), (24, 28, 34), (96, 132, 170)]
    sheet = Image.new("RGB", (len(grounds) * cell, len(icons) * cell), (255, 255, 255))
    for r, im in enumerate(icons):
        k = min((cell - 8) / im.width, (cell - 8) / im.height)
        t = im.convert("RGBa").resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.LANCZOS).convert("RGBA")
        for c, g in enumerate(grounds):
            tile = Image.new("RGBA", (cell, cell), g + (255,))
            tile.alpha_composite(t, ((cell - t.width) // 2, (cell - t.height) // 2))
            sheet.paste(tile.convert("RGB"), (c * cell, r * cell))
    sheet.save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--model", default="u2net")
    args = ap.parse_args()
    only = {s for s in args.only.split(",") if s}
    cfg = json.loads((Path(__file__).resolve().parent / "sheets.json").read_text(encoding="utf-8"))
    sess = new_session(args.model)
    (OUT / "sm").mkdir(parents=True, exist_ok=True)
    REVIEW.mkdir(parents=True, exist_ok=True)
    report = []
    for sheet in cfg["sheets"]:
        ids = sheet["ids"]
        if only and not (only & set(ids)):
            continue
        img = Image.open(SRC / sheet["file"]).convert("RGB")
        boxes = grid_boxes(img, sheet["cols"], sheet["rows"])
        assert len(boxes) == len(ids), sheet["file"]
        done = []
        for icon_id, box in zip(ids, boxes):
            if only and icon_id not in only:
                continue
            big, own = expand(box, img.size, cfg.get("margins", {}).get(icon_id, 0.12))
            cell = img.crop(big)
            method = cfg["methods"]["byId"].get(icon_id) or cfg["methods"]["byGroup"].get(sheet["group"]) or cfg["methods"]["default"]
            if method == "u2net":
                model = remove(cell, session=sess, post_process_mask=False)
                rgba = refine(np.asarray(cell), np.asarray(model.getchannel("A")))
            elif method == "flood":
                rgba = flood_matte(np.asarray(cell), shadow_max_dark=45, grad_max=3.5)
            elif method == "flood_noshadow":
                rgba = flood_matte(np.asarray(cell), shadow_max_dark=45, grad_max=3.5, shadow_gain=0.0)
            else:
                raise SystemExit("unknown method " + method)
            rgba = keep_own(rgba, own)
            im = Image.fromarray(rgba, "RGBA")
            bbox = im.getchannel("A").getbbox()
            touches = bbox[0] == 0 or bbox[1] == 0 or bbox[2] == im.width or bbox[3] == im.height
            im = im.crop(bbox)
            for sub, side in SIZES.items():
                out = fit(im, side)
                dest = (OUT / sub / f"{icon_id}.webp") if sub else (OUT / f"{icon_id}.webp")
                out.save(dest, "WEBP", quality=86, method=6, alpha_quality=90)
            done.append(im)
            report.append({"id": icon_id, "sheet": sheet["file"], "method": method, "box": list(box),
                           "size": list(im.size), "touchesCellEdge": bool(touches)})
            print(icon_id, im.size, "EDGE!" if touches else "")
        if done and not only:
            review_sheet(done, REVIEW / (Path(sheet["file"]).stem[:8] + "_" + ids[0] + ".png"))
    if not only:
        (Path(__file__).resolve().parent / "cut_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
