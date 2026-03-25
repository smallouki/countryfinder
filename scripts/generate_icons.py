#!/usr/bin/env python3
"""Generate extension icons: stylized Africa (+ tiny Madagascar) on ocean blue."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

# Normalized coords (0–1), north = small y. Stylized Africa: wide north, Gulf bulge west, Horn east, taper south.
AFRICA_DETAIL = [
    (0.40, 0.12),
    (0.48, 0.08),
    (0.56, 0.09),
    (0.54, 0.18),
    (0.56, 0.24),
    (0.60, 0.28),
    (0.68, 0.30),
    (0.74, 0.36),
    (0.71, 0.44),
    (0.63, 0.52),
    (0.58, 0.64),
    (0.54, 0.78),
    (0.50, 0.90),
    (0.42, 0.86),
    (0.36, 0.66),
    (0.32, 0.44),
    (0.30, 0.28),
    (0.33, 0.16),
    (0.36, 0.11),
]

# Fewer vertices for 16–22 px: keep Horn + wide top + narrow south
AFRICA_MINI = [
    (0.40, 0.14),
    (0.52, 0.08),
    (0.58, 0.20),
    (0.70, 0.32),
    (0.60, 0.58),
    (0.50, 0.88),
    (0.38, 0.70),
    (0.30, 0.36),
    (0.34, 0.16),
]

# Island east of mainland
MADAGASCAR = [
    (0.715, 0.50),
    (0.755, 0.48),
    (0.775, 0.70),
    (0.735, 0.74),
    (0.705, 0.58),
]

OCEAN = (22, 56, 98, 255)
OCEAN_EDGE = (48, 98, 155, 255)
LAND = (205, 192, 160, 255)
LAND_SHADOW = (165, 148, 118, 255)


def _to_px(pts: list[tuple[float, float]], n: int, pad: int) -> list[tuple[int, int]]:
    iw = n - 2 * pad
    ih = n - 2 * pad
    out: list[tuple[int, int]] = []
    for x, y in pts:
        out.append((pad + int(round(x * iw)), pad + int(round(y * ih))))
    return out


def draw_icon(n: int) -> Image.Image:
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = n / 128.0

    def R(x: float) -> int:
        return max(1, int(round(x * s)))

    pad = 1 if n <= 20 else max(2, R(6))
    rad = max(2, min(n // 4, R(20) if n > 20 else 4))

    d.rounded_rectangle(
        [pad, pad, n - pad - 1, n - pad - 1],
        radius=rad,
        fill=OCEAN,
        outline=OCEAN_EDGE,
        width=max(1, R(2) if n > 20 else 1),
    )

    use_mini = n <= 22
    africa_pts = AFRICA_MINI if use_mini else AFRICA_DETAIL
    lw = max(1, R(2) if n > 40 else 1)

    main = _to_px(africa_pts, n, pad)
    d.polygon(main, fill=LAND, outline=LAND_SHADOW, width=lw)

    if not use_mini:
        mad = _to_px(MADAGASCAR, n, pad)
        d.polygon(mad, fill=LAND, outline=LAND_SHADOW, width=max(1, lw - 1))

    return img


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    out = root / "icons"
    out.mkdir(parents=True, exist_ok=True)
    for size in (16, 48, 128):
        im = draw_icon(size)
        im.save(out / f"icon{size}.png", "PNG")
        print("wrote", out / f"icon{size}.png")


if __name__ == "__main__":
    main()
