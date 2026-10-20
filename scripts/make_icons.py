"""
Generates the Chatgram app icon for every platform from one definition.

    python scripts/make_icons.py

Outputs:
  client/assets/branding/icon.png            (1024, master)
  client/android/.../mipmap-*/ic_launcher.png           (legacy launcher)
  client/android/.../mipmap-*/ic_launcher_foreground.png (adaptive foreground)
  client/android/.../mipmap-anydpi-v26/ic_launcher.xml   (adaptive icon)
  client/android/.../values/ic_launcher_background.xml   (adaptive colour)
  client/web/icons/Icon-*.png, favicon.png   (PWA / browser)
  client/windows/runner/resources/app_icon.ico
"""
from pathlib import Path
import math

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
CLIENT = ROOT / "client"

# WhatsApp-ish palette.
GREEN_DARK = (7, 94, 84)
GREEN_MID = (0, 128, 105)
GREEN_BRIGHT = (37, 211, 102)
WHITE = (255, 255, 255, 255)

SS = 4  # supersampling factor for smooth edges


def rounded_square(size: int, radius_fraction: float = 0.22) -> Image.Image:
    """Rounded-square icon body with a diagonal green gradient."""
    big = size * SS
    gradient = Image.new("RGBA", (big, big))
    draw = ImageDraw.Draw(gradient)

    for y in range(big):
        for_t = y / max(big - 1, 1)
        # Blend across the diagonal for a bit of depth.
        colour = tuple(
            int(GREEN_DARK[i] + (GREEN_MID[i] - GREEN_DARK[i]) * for_t) for i in range(3)
        )
        draw.line([(0, y), (big, y)], fill=colour + (255,))

    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, big - 1, big - 1], radius=int(big * radius_fraction), fill=255
    )

    out = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    out.paste(gradient, (0, 0), mask)
    # Downscale from the supersampled canvas for smooth edges.
    return out.resize((size, size), Image.LANCZOS)


def speech_bubble(size: int, scale: float = 0.50) -> Image.Image:
    """White speech bubble on a transparent canvas."""
    big = size * SS
    layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    w = big * scale
    h = w * 0.76
    x0 = (big - w) / 2
    y0 = (big - h) / 2 - big * 0.02
    radius = h * 0.30

    draw.rounded_rectangle([x0, y0, x0 + w, y0 + h], radius=radius, fill=WHITE)

    # Tail on the lower-left. It overlaps the bubble body so the two shapes
    # merge without a visible seam.
    tail_x = x0 + w * 0.26
    tail_y = y0 + h
    draw.polygon(
        [
            (tail_x, tail_y - h * 0.22),
            (tail_x + w * 0.20, tail_y - h * 0.22),
            (tail_x - w * 0.03, tail_y + h * 0.28),
        ],
        fill=WHITE,
    )

    return layer.resize((size, size), Image.LANCZOS)


def compose(size: int, with_background: bool = True) -> Image.Image:
    """The full icon: green rounded square + white bubble."""
    base = rounded_square(size) if with_background else Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bubble = speech_bubble(size, scale=0.50 if with_background else 0.58)
    base.alpha_composite(bubble)
    return base


def adaptive_foreground(size: int) -> Image.Image:
    """
    Adaptive-icon foreground. Android masks the outer ~33%, so the bubble is
    kept inside the central safe zone.
    """
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bubble = speech_bubble(size, scale=0.40)
    layer.alpha_composite(bubble)
    return layer


def save(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "PNG")
    print(f"  wrote {path.relative_to(ROOT)}  ({image.width}x{image.height})")


def main() -> None:
    print("Chatgram icon generator\n")

    # ------------------------------------------------------------- master
    master = compose(1024)
    save(master, CLIENT / "assets" / "branding" / "icon.png")

    # ------------------------------------------------------------ android
    # Legacy launcher icons (mdpi..xxxhdpi).
    legacy = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    for density, size in legacy.items():
        save(
            compose(size),
            CLIENT / "android" / "app" / "src" / "main" / "res"
            / f"mipmap-{density}" / "ic_launcher.png",
        )

    # Adaptive foreground (108dp canvas per density).
    adaptive = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
    for density, size in adaptive.items():
        save(
            adaptive_foreground(size),
            CLIENT / "android" / "app" / "src" / "main" / "res"
            / f"mipmap-{density}" / "ic_launcher_foreground.png",
        )

    # Adaptive icon descriptor + background colour.
    anydpi = CLIENT / "android" / "app" / "src" / "main" / "res" / "mipmap-anydpi-v26"
    anydpi.mkdir(parents=True, exist_ok=True)
    (anydpi / "ic_launcher.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@color/ic_launcher_background"/>\n'
        '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
        "</adaptive-icon>\n",
        encoding="utf-8",
    )
    print(f"  wrote {anydpi.relative_to(ROOT)}/ic_launcher.xml")

    values = CLIENT / "android" / "app" / "src" / "main" / "res" / "values"
    values.mkdir(parents=True, exist_ok=True)
    (values / "ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<resources>\n"
        "    <color name=\"ic_launcher_background\">#075E54</color>\n"
        "</resources>\n",
        encoding="utf-8",
    )
    print(f"  wrote {values.relative_to(ROOT)}/ic_launcher_background.xml")

    # ----------------------------------------------------------------- web
    web_icons = CLIENT / "web" / "icons"
    for name, size in [
        ("Icon-192.png", 192),
        ("Icon-512.png", 512),
        ("Icon-maskable-192.png", 192),
        ("Icon-maskable-512.png", 512),
    ]:
        # Maskable icons need the artwork inside the safe zone, so no rounded
        # corners — the platform applies the mask.
        if "maskable" in name:
            canvas = Image.new("RGBA", (size, size), GREEN_DARK)
            gradient = rounded_square(size, radius_fraction=0.0)
            canvas.alpha_composite(gradient)
            canvas.alpha_composite(speech_bubble(size, scale=0.44))
            save(canvas, web_icons / name)
        else:
            save(compose(size), web_icons / name)

    save(compose(64), CLIENT / "web" / "favicon.png")

    # ------------------------------------------------------------- windows
    ico_path = CLIENT / "windows" / "runner" / "resources" / "app_icon.ico"
    ico_path.parent.mkdir(parents=True, exist_ok=True)
    icon_sizes = [16, 24, 32, 48, 64, 128, 256]
    master.save(ico_path, format="ICO", sizes=[(s, s) for s in icon_sizes])
    print(f"  wrote {ico_path.relative_to(ROOT)}  ({', '.join(str(s) for s in icon_sizes)})")

    print("\nDone.")


if __name__ == "__main__":
    main()
