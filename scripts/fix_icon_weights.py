#!/usr/bin/env python3
"""
Switch regular-weight FontAwesome icons to their solid equivalents.

font_awesome_flutter v11 exposes BOTH weights under different names: the plain
name (e.g. `bell`) is often the *regular*/outline glyph, while `solidBell` is the
filled one. Mixing the two makes the UI look thin and inconsistent next to
brand-filled elements.

This script reads the package's own definitions, works out which family each
plain name uses, and rewrites `lib/core/app_icons.dart` to prefer the `solid*`
alias wherever one exists.

Usage:
    python scripts/fix_icon_weights.py [--dry-run]
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ICONS_FILE = ROOT / "client" / "lib" / "core" / "app_icons.dart"
PKG = (
    Path.home()
    / "AppData"
    / "Local"
    / "Pub"
    / "Cache"
    / "hosted"
    / "pub.dev"
    / "font_awesome_flutter-11.0.0"
    / "lib"
    / "font_awesome_flutter.dart"
)

DECL = re.compile(r"static const FaIconData (\w+) = FaIconData\(")
ALIAS = re.compile(r"static const FaIconData (\w+) = (\w+);")
FAMILY = re.compile(r"fontFamily: 'FontAwesome(\w+)'")


def parse_package():
    """name -> (family, is_alias_of)."""
    text = PKG.read_text(encoding="utf-8", errors="replace")
    info = {}

    # Aliases first: `solidContactBook = solidAddressBook;`
    for m in ALIAS.finditer(text):
        name, target = m.group(1), m.group(2)
        if name != target:
            info[name] = ("alias", target)

    # Real declarations: capture the IconData block that follows.
    for m in DECL.finditer(text):
        name = m.group(1)
        block = text[m.end(): m.end() + 600]
        fam = FAMILY.search(block)
        if fam:
            info[name] = (fam.group(1), None)

    # Resolve aliases to their family.
    for name, (fam, target) in list(info.items()):
        if fam == "alias":
            seen = set()
            cur = target
            while cur in info and info[cur][0] == "alias" and cur not in seen:
                seen.add(cur)
                cur = info[cur][1]
            resolved = info.get(cur, ("Unknown", None))[0]
            info[name] = (resolved, None)

    return info


def main():
    dry = "--dry-run" in sys.argv
    info = parse_package()
    print(f"parsed {len(info)} icon definitions from the package")

    source = ICONS_FILE.read_text(encoding="utf-8")
    used = re.findall(r"FontAwesomeIcons\.(\w+)", source)
    print(f"app_icons.dart references {len(used)} distinct FontAwesome icons")

    replacements = {}
    for name in sorted(set(used)):
        family = info.get(name, ("Unknown", None))[0]
        solid = f"solid{name[0].upper()}{name[1:]}"
        if family == "Regular" and solid in info:
            replacements[name] = solid
        elif family == "Regular" and solid not in info:
            # No solid twin exists; leave it (nothing better to use).
            pass

    print(f"\nswitching {len(replacements)} regular icons to solid:")
    for old, new in replacements.items():
        print(f"  {old:<28} -> {new}")

    updated = source
    for old, new in replacements.items():
        # Word-boundary match: `circle` must not rewrite `circleInfo`.
        updated = re.sub(
            rf"FontAwesomeIcons\.{re.escape(old)}\b",
            f"FontAwesomeIcons.{new}",
            updated,
        )

    if dry:
        print("\n[dry run] not writing")
        return

    ICONS_FILE.write_text(updated, encoding="utf-8", newline="\n")
    print(f"\nwrote {ICONS_FILE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
