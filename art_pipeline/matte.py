"""Alpha refinement for renders on a known plain white background.

rembg gives a good silhouette but keeps white haze inside thin structures
(bicycle frames, fan grilles, gaps between tools). Because the sheet
background is known to be white, an uncertain pixel can be re-estimated:
the smallest alpha that can explain its colour over white is
(255 - min(R,G,B)) / 255, and dark or grey thin structures are close to that
bound. Confident pixels keep the model alpha, so white objects (washing
machine, paper) are not eaten.
"""
import numpy as np
from scipy import ndimage as ndi


def refine(rgb_u8, model_alpha_u8, bg=254.0, lo=0.04, hi=0.94, slack=1.35, min_alpha=10, min_area=40):
    rgb = rgb_u8.astype(np.float32)
    am = model_alpha_u8.astype(np.float32) / 255.0
    a_min = np.clip((bg - rgb.min(axis=2)) / bg, 0.0, 1.0)
    a = am.copy()
    unsure = (am > lo) & (am < hi)
    a[unsure] = np.minimum(am[unsure], np.clip(a_min[unsure] * slack, 0.0, 1.0))
    a[am <= lo] = 0.0
    # un-premultiply the white background out of the colour
    safe = np.maximum(a, 1e-3)[..., None]
    fg = (rgb - (1.0 - a[..., None]) * bg) / safe
    fg = np.where(a[..., None] >= 0.999, rgb, fg)
    fg = np.clip(fg, 0, 255)
    a8 = np.round(a * 255).astype(np.uint8)
    a8[a8 < min_alpha] = 0
    # drop tiny islands (dust, halo fragments)
    lab, n = ndi.label(a8 > 0, structure=np.ones((3, 3), bool))
    if n > 1:
        areas = np.bincount(lab.ravel())
        keep = areas >= max(min_area, int(areas[1:].max() * 0.004))
        keep[0] = False
        a8[~keep[lab]] = 0
    return np.dstack([fg.astype(np.uint8), a8])
