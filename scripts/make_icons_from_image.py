#!/usr/bin/env python3
"""
Generate every platform icon from a single square source image.

Usage:
    python scripts/make_icons_from_image.py <source.png>

Source should be a square PNG (1024x1024 is ideal). Unlike make_icons.py, which
draws the mark programmatically, this takes the real artwork and derives all
required sizes for Android, Windows, web and the marketing site.

Outputs
-------
  client/assets/branding/icon.png                 master 1024
  client/android/.../mipmap-*/ic_launcher.png     48..192
  client/android/.../mipmap-*/ic_launcher_foreground.png  108..432 (transparent, inset)
  client/web/favicon.png                          64
  client/web/icons/Icon-{192,512}.png             PWA
  client/web/icons/Icon-maskable-{192,512}.png    PWA maskable (safe-zone padded)
  client/windows/runner/resources/app_icon.ico    16..256 multi-size
  client/landing/public/assets/favicon.png        64
  client/landing/public/assets/og-image.png       1024 (social card)
"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CLIENT = ROOT / "client"

ANDROID_RES = CLIENT / "android" / "app" / "src" / "main" / "res"
ANDROID_DENSITIES = {
    "mipmap-mdpi": (48, 108),
    "mipmap-hdpi": (72, 162),
    "mipmap-xhdpi": (96, 216),
    "mipmap-xxhdpi": (144, 324),
    "mipmap-xxxhdpi": (192, 432),
}

# Adaptive icons are masked: keep artwork inside the middle ~66% so nothing
# important is clipped by the launcher's circle/squircle/rounded-square mask.
ADAPTIVE_INSET = 1.0
# PWA maskable safe zone.
MASKABLE_INSET = 0.80
# Sampled from the source artwork so padded canvases blend with it.
BRAND_BG = (11, 58, 51, 255)


def load_square(path: Path) -> Image.Image:
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    if w != h:
        side = min(w, h)
        left = (w - side) // 2
        top = (h - side) // 2
        img = img.crop((left, top, left + side, top + side))
    if img.size[0] < 1024:
        img = img.resize((1024, 1024), Image.LANCZOS)
    return img


def plain(master: Image.Image, size: int) -> Image.Image:
    return master.resize((size, size), Image.LANCZOS)


def inset(master: Image.Image, size: int, fraction: float) -> Image.Image:
    """Artwork scaled into the middle `fraction` of a square canvas."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = max(1, int(size * fraction))
    art = master.resize((inner, inner), Image.LANCZOS)
    offset = (size - inner) // 2
    canvas.paste(art, (offset, offset), art)
    return canvas


def save(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG", optimize=True)
    print(f"  {path.relative_to(ROOT)}  {img.size[0]}x{img.size[1]}")


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: make_icons_from_image.py <source.png>")
        raise SystemExit(2)

    src = Path(sys.argv[1])
    if not src.exists():
        print(f"source not found: {src}")
        raise SystemExit(2)

    master = load_square(src)
    print(f"source: {src} -> {master.size[0]}x{master.size[1]}\n")

    # ---- master -----------------------------------------------------------
    save(master, CLIENT / "assets" / "branding" / "icon.png")

    # ---- android ----------------------------------------------------------
    for folder, (launcher, foreground) in ANDROID_DENSITIES.items():
        save(plain(master, launcher), ANDROID_RES / folder / "ic_launcher.png")
        save(inset(master, foreground, ADAPTIVE_INSET), ANDROID_RES / folder / "ic_launcher_foreground.png")

    # ---- web / PWA --------------------------------------------------------
    save(plain(master, 64), CLIENT / "web" / "favicon.png")
    save(plain(master, 192), CLIENT / "web" / "icons" / "Icon-192.png")
    save(plain(master, 512), CLIENT / "web" / "icons" / "Icon-512.png")
    save(inset(master, 192, MASKABLE_INSET), CLIENT / "web" / "icons" / "Icon-maskable-192.png")
    save(inset(master, 512, MASKABLE_INSET), CLIENT / "web" / "icons" / "Icon-maskable-512.png")

    # ---- windows ----------------------------------------------------------
    ico = CLIENT / "windows" / "runner" / "resources" / "app_icon.ico"
    ico.parent.mkdir(parents=True, exist_ok=True)
    sizes = [16, 24, 32, 48, 64, 128, 256]
    master.save(ico, format="ICO", sizes=[(s, s) for s in sizes])
    print(f"  {ico.relative_to(ROOT)}  ico {sizes}")

    # ---- marketing site ---------------------------------------------------
    save(plain(master, 64), CLIENT / "landing" / "public" / "assets" / "favicon.png")
    save(master, CLIENT / "landing" / "public" / "assets" / "og-image.png")

    # ---- repo assets ------------------------------------------------------
    save(master, CLIENT / "assets" / "branding" / "icon.png")
    print("\nDone.")


if __name__ == "__main__":
    main()
