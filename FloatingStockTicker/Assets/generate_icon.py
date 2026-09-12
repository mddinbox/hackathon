"""Generate the native multi-resolution app icon without runtime dependencies."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw


SIZES = (16, 24, 32, 48, 64, 128, 256)
BACKGROUND = "#2B3037"
BORDER = "#697888"
TREND = "#4CC9F0"
POSITIVE = "#50D394"
POINT = "#FBBF24"


def render(size: int) -> Image.Image:
    scale = 4
    canvas_size = size * scale
    image = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    def point(x: float, y: float) -> tuple[int, int]:
        return round(x * size * scale), round(y * size * scale)

    draw.rounded_rectangle(
        (point(8 / 256, 8 / 256), point(248 / 256, 248 / 256)),
        radius=round(52 / 256 * canvas_size),
        fill=BACKGROUND,
        outline=BORDER,
        width=max(1, round(8 / 256 * canvas_size)),
    )

    trend = [
        point(40 / 256, 170 / 256),
        point(80 / 256, 154 / 256),
        point(111 / 256, 169 / 256),
        point(145 / 256, 120 / 256),
        point(177 / 256, 133 / 256),
        point(216 / 256, 82 / 256),
    ]
    stroke = max(1, round(16 / 256 * canvas_size))
    draw.line(trend, fill=TREND, width=stroke, joint="curve")
    radius = stroke // 2
    for x, y in trend:
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=TREND)

    arrow_start = point(197 / 256, 82 / 256)
    arrow_corner = point(216 / 256, 82 / 256)
    arrow_end = point(216 / 256, 101 / 256)
    draw.line((arrow_start, arrow_corner, arrow_end), fill=POSITIVE, width=stroke, joint="curve")
    for x, y in (arrow_start, arrow_corner, arrow_end):
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=POSITIVE)

    point_center = point(145 / 256, 120 / 256)
    point_radius = max(1, round(9 / 256 * canvas_size))
    draw.ellipse(
        (
            point_center[0] - point_radius,
            point_center[1] - point_radius,
            point_center[0] + point_radius,
            point_center[1] + point_radius,
        ),
        fill=POINT,
    )

    return image.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).with_name("FloatingStockTicker.ico"),
    )
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)

    render(256).save(
        args.output,
        format="ICO",
        sizes=[(size, size) for size in SIZES],
    )


if __name__ == "__main__":
    main()
