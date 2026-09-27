"""Classical matte for renders on flat white: flood fill + soft-shadow model.

Used for dioramas (mines, plants) where salient-object models keep only the
vehicles and drop pale terrain. The flat background is flooded from the cell
border. Soft ground shadows are low-contrast and change slowly, so a second
flood continues from the background through pixels with a small gradient and
turns them into a translucent black shadow. Object silhouettes have a sharp
edge, which stops that flood, so pale objects keep their pixels.
"""
import numpy as np
from scipy import ndimage as ndi


def _flood(seed, passable):
    lab, _ = ndi.label(passable, structure=np.ones((3, 3), bool))
    ids = np.unique(lab[seed & passable])
    ids = ids[ids > 0]
    return np.isin(lab, ids)


def flood_matte(rgb_u8, bg=254.0, bg_tol=4.0, grad_max=5.0, shadow_max_dark=70.0,
                sat_max=14.0, shadow_gain=0.85, edge_px=2, slack=1.25, min_alpha=10, min_area=60):
    rgb = rgb_u8.astype(np.float32)
    lum = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    dark = bg - rgb.min(axis=2)
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    h, w = lum.shape
    border = np.zeros((h, w), bool)
    border[0, :] = border[-1, :] = border[:, 0] = border[:, -1] = True

    # 1) exact background
    bg_mask = _flood(border, dark <= bg_tol)

    # 2) soft shadows reachable from the background through smooth, pale, grey pixels
    sm = ndi.gaussian_filter(lum, 1.0)
    grad = np.hypot(ndi.sobel(sm, 1), ndi.sobel(sm, 0)) / 8.0
    shadowish = (grad <= grad_max) & (dark <= shadow_max_dark) & (sat <= sat_max)
    shadow = _flood(bg_mask, shadowish | bg_mask) & ~bg_mask

    obj = ~(bg_mask | shadow)
    a = np.zeros((h, w), np.float32)
    out = rgb.copy()
    a[obj] = 1.0
    # translucent black ground shadow
    a_sh = np.clip(dark / bg * shadow_gain, 0.0, 0.55)
    a[shadow] = a_sh[shadow]
    out[shadow] = 0.0

    # 3) anti-aliased silhouette edge: re-estimate alpha against white
    near_bg = ndi.binary_dilation(bg_mask | shadow, iterations=edge_px) & obj
    a_min = np.clip(dark / bg, 0.0, 1.0)
    a_edge = np.clip(a_min * slack + 0.05, 0.0, 1.0)
    a[near_bg] = a_edge[near_bg]
    e = near_bg & (a > 1e-3)
    out[e] = (rgb[e] - (1.0 - a[e])[:, None] * bg) / a[e][:, None]
    out = np.clip(out, 0, 255)

    a8 = np.round(a * 255).astype(np.uint8)
    a8[a8 < min_alpha] = 0
    lab, n = ndi.label(a8 > 0, structure=np.ones((3, 3), bool))
    if n > 1:
        areas = np.bincount(lab.ravel())
        keep = areas >= max(min_area, int(areas[1:].max() * 0.004))
        keep[0] = False
        a8[~keep[lab]] = 0
    return np.dstack([out.astype(np.uint8), a8])
