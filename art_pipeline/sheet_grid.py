"""Find cell boxes on a white-background sprite sheet with a known grid layout.

Cut lines are placed at the whitest line inside a window around the expected
position. The long axis is split per strip (each column of a 2x5 sheet gets
its own row cuts), so an object that sits higher in one column does not leak
into the neighbouring cell.
"""
import numpy as np
from PIL import Image


def ink_mask(arr, tol=14):
    rgb = arr[..., :3].astype(np.int16)
    return (255 - rgb.min(axis=2)) > tol


def best_cut(profile, expected, window):
    lo = max(1, int(expected - window))
    hi = min(len(profile) - 1, int(expected + window))
    # smooth the whole profile first: smoothing only the window would pad its
    # ends with zeros and make the window edges look falsely empty
    k = 9
    sm = np.convolve(profile, np.ones(k) / k, mode="same")[lo:hi]
    best = sm.min()
    idx = np.flatnonzero(sm <= best + 1e-6)
    return int(lo + idx[len(idx) // 2])


def cuts(profile, n, window_frac):
    size = len(profile)
    return [0] + [best_cut(profile, size * i / n, size / n * window_frac) for i in range(1, n)] + [size]


def grid_boxes(img, cols, rows, window_frac=0.22):
    ink = ink_mask(np.asarray(img.convert("RGB")))
    boxes = [None] * (cols * rows)
    if rows >= cols:
        xs = cuts(ink.sum(axis=0).astype(float), cols, window_frac)
        for c in range(cols):
            ys = cuts(ink[:, xs[c]:xs[c + 1]].sum(axis=1).astype(float), rows, window_frac)
            for r in range(rows):
                boxes[r * cols + c] = (xs[c], ys[r], xs[c + 1], ys[r + 1])
    else:
        ys = cuts(ink.sum(axis=1).astype(float), rows, window_frac)
        for r in range(rows):
            xs = cuts(ink[ys[r]:ys[r + 1], :].sum(axis=0).astype(float), cols, window_frac)
            for c in range(cols):
                boxes[r * cols + c] = (xs[c], ys[r], xs[c + 1], ys[r + 1])
    return boxes
