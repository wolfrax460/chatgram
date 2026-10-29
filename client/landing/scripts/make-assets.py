"""Generate the landing page's static image set from existing, real brand assets.

Run from anywhere:

    python client/landing/scripts/make-assets.py

Inputs (all pre-existing in the repo, nothing is invented):
  * client/web/icons/Icon-512.png          - the Chatgram app icon (512x512)
  * client/web/icons/Icon-maskable-512.png - the maskable variant of the same icon
  * apps/web/public/chatgram-icon.svg      - the vector mark the web app ships
  * client/landing/public/assets/landing-chat-list.png      - real app screenshot
  * client/landing/public/assets/landing-conversation.png   - real app screenshot
  * client/landing/public/assets/landing-ai.png             - real app screenshot

Outputs (written into client/landing/public/assets):
  * chatgram-icon.svg          (copy of the app's own vector mark)
  * favicon-16/32/48.png, apple-touch-icon.png
  * ../favicon.ico (multi-resolution)
  * icon-192.png, icon-512.png, icon-maskable-512.png
  * og-image-1200x630.png      (social card composed from the icon + a real screenshot)
  * chatgram-app-chats-dark-{760,1366}.webp + chatgram-app-chats-dark.png
  * chatgram-app-conversation-dark-{760,1366}.webp + ...png
  * chatgram-ai-chat-dark-{760,1366}.webp + ...png

The legacy landing-*.png screenshots stay in place because external links and the
existing Playwright landing spec fetch those exact paths.
"""

import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

LANDING = Path(__file__).resolve().parents[1]
CLIENT = LANDING.parent
REPO = CLIENT.parent
ASSETS = LANDING / "public" / "assets"

ICON = CLIENT / "web" / "icons" / "Icon-512.png"
MASKABLE = CLIENT / "web" / "icons" / "Icon-maskable-512.png"
ICON_SVG = REPO / "apps" / "web" / "public" / "chatgram-icon.svg"

SHOTS = {
    "chatgram-app-chats-dark": LANDING / "public" / "assets" / "landing-chat-list.png",
    "chatgram-app-conversation-dark": LANDING / "public" / "assets" / "landing-conversation.png",
    "chatgram-ai-chat-dark": LANDING / "public" / "assets" / "landing-ai.png",
}

# Real phone-portrait captures of the app. The hero phone mockup uses phone-sized
# WebP derivatives of these; the PNG originals stay as the <picture> fallback.
PHONE_SHOTS = {
    "chatgram-phone-chats": LANDING / "public" / "assets" / "web-chat-list.png",
    "chatgram-phone-conversation": LANDING / "public" / "assets" / "web-conversation.png",
}

FONT_BOLD = "C:/Windows/Fonts/segoeuib.ttf"
FONT_REGULAR = "C:/Windows/Fonts/segoeui.ttf"
FONT_SEMI = "C:/Windows/Fonts/segoeui.ttf"

BRAND = (0, 128, 105)
DARK = (11, 20, 26)
DARK_TEAL = (8, 58, 49)
SOFT = (183, 199, 195)
MUTED = (134, 150, 160)
WHITE = (255, 255, 255)


def flatten(img: Image.Image, background):
    """Flatten transparent pixels onto a solid colour (for opaque icon slots)."""
    img = img.convert("RGBA")
    canvas = Image.new("RGBA", img.size, background + (255,))
    canvas.alpha_composite(img)
    return canvas.convert("RGB")


def png(img: Image.Image, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG", optimize=True)
    print(f"  wrote {path.relative_to(LANDING.parent.parent)} ({path.stat().st_size:,} B)")


def webp(img: Image.Image, path: Path, quality=82):
    img.save(path, "WEBP", quality=quality, method=6)
    print(f"  wrote {path.relative_to(LANDING.parent.parent)} ({path.stat().st_size:,} B)")


def main():
    icon = Image.open(ICON).convert("RGBA")
    maskable = Image.open(MASKABLE).convert("RGBA")

    print("icons:")
    for size in (16, 32, 48):
        png(icon.resize((size, size), Image.LANCZOS), ASSETS / f"favicon-{size}.png")
    png(icon.resize((192, 192), Image.LANCZOS), ASSETS / "icon-192.png")
    png(icon.resize((512, 512), Image.LANCZOS), ASSETS / "icon-512.png")
    png(maskable.resize((512, 512), Image.LANCZOS), ASSETS / "icon-maskable-512.png")
    png(flatten(icon.resize((180, 180), Image.LANCZOS), DARK), ASSETS / "apple-touch-icon.png")

    ico = LANDING / "public" / "favicon.ico"
    ico.parent.mkdir(parents=True, exist_ok=True)
    icon.save(ico, sizes=[(16, 16), (32, 32), (48, 48)])
    print(f"  wrote public/favicon.ico ({ico.stat().st_size:,} B)")

    print("app mark (vector, copied verbatim from the web app):")
    if ICON_SVG.exists():
        shutil.copyfile(ICON_SVG, ASSETS / "chatgram-icon.svg")
        print(f"  wrote assets/chatgram-icon.svg ({ICON_SVG.stat().st_size:,} B)")
    else:
        print(f"  skipped assets/chatgram-icon.svg ({ICON_SVG} missing)")

    print("screenshots:")
    for name, src in SHOTS.items():
        shot = Image.open(src).convert("RGB")
        png(shot, ASSETS / f"{name}.png")
        webp(shot.resize((1366, 860), Image.LANCZOS), ASSETS / f"{name}-1366.webp")
        webp(shot.resize((760, 478), Image.LANCZOS), ASSETS / f"{name}-760.webp")

    print("phone screens (hero mockup):")
    for name, src in PHONE_SHOTS.items():
        shot = Image.open(src).convert("RGB")
        for width in (430, 860):
            height = round(shot.height * width / shot.width)
            webp(shot.resize((width, height), Image.LANCZOS), ASSETS / f"{name}-{width}.webp")

    print("social card:")
    make_og_image(icon)


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def fit_font(draw, text, path, max_width, size, min_size=18):
    while size > min_size:
        font = ImageFont.truetype(path, size)
        if draw.textlength(text, font=font) <= max_width:
            return font
        size -= 1
    return ImageFont.truetype(path, min_size)


def make_og_image(icon: Image.Image):
    """1200x630 card: brand gradient, icon, headline and a real app screenshot."""
    W, H = 1200, 630
    canvas = Image.new("RGB", (W, H), DARK)
    draw = ImageDraw.Draw(canvas)

    # Diagonal dark-teal -> near-black gradient.
    for y in range(H):
        draw.line([(0, y), (W, y)], fill=lerp(DARK_TEAL, DARK, y / (H - 1)))

    # Soft brand glow behind the copy.
    glow = Image.new("L", (W, H), 0)
    gdraw = ImageDraw.Draw(glow)
    gdraw.ellipse((-260, -220, 620, 420), fill=90)
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    canvas.paste(Image.new("RGB", (W, H), (0, 168, 132)), (0, 0), glow)

    draw = ImageDraw.Draw(canvas)

    # Icon + wordmark.
    logo = icon.resize((104, 104), Image.LANCZOS)
    canvas.paste(logo, (72, 66), logo)
    wordmark = ImageFont.truetype(FONT_BOLD, 58)
    draw.text((196, 78), "Chatgram", font=wordmark, fill=WHITE)

    # Headline.
    line1 = "Free messaging app for"
    line2 = "Android, Windows and the web."
    f1 = fit_font(draw, line1, FONT_BOLD, 520, 40)
    f2 = fit_font(draw, line2, FONT_BOLD, 520, 40)
    draw.text((72, 232), line1, font=f1, fill=WHITE)
    draw.text((72, 284), line2, font=f2, fill=WHITE)

    # Feature line.
    feat = ImageFont.truetype(FONT_REGULAR, 26)
    draw.text((74, 372), "Groups  ·  24-hour status  ·  Calls  ·  Chatgram AI", font=feat, fill=(141, 214, 195))

    # Small trust line (facts only, no ratings or reviews).
    small = ImageFont.truetype(FONT_SEMI, 22)
    draw.text((74, 438), "Free  ·  No adverts  ·  Android, Windows, web", font=small, fill=MUTED)

    # Screenshot inside a rounded window frame (real app capture).
    shot = Image.open(SHOTS["chatgram-ai-chat-dark"]).convert("RGB")
    shot = shot.resize((440, 294), Image.LANCZOS)
    radius = 18
    card = Image.new("RGBA", (452, 306), (17, 27, 33, 255))
    cdraw = ImageDraw.Draw(card)
    cdraw.rounded_rectangle((0, 0, 451, 305), radius=radius, fill=(17, 27, 33, 255), outline=(46, 61, 71, 255), width=2)
    inner = Image.new("RGBA", (452, 306), (0, 0, 0, 0))
    mask = Image.new("L", (440, 294), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, 439, 293), radius=12, fill=255)
    inner.paste(shot, (6, 6), mask)
    card.alpha_composite(inner)
    canvas.paste(card, (688, 162), card)

    out = ASSETS / "og-image-1200x630.png"
    canvas.save(out, "PNG", optimize=True)
    print(f"  wrote {out.relative_to(LANDING.parent.parent)} ({out.stat().st_size:,} B)")


if __name__ == "__main__":
    main()
