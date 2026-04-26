#!/usr/bin/env python3
"""
One-shot transform of src/tunables.js based on the weapon_assignments.json
the user produced via the weapon_assigner tool. Deletes flagged weapons,
renames revisitAs entries, and appends new lowpoly entries.

Re-runnable: idempotent re-runs find the renames as-already-applied and
skip; deletions guard against missing names.
"""
import json, re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
TUN = ROOT / 'src' / 'tunables.js'

# --- Maps ----------------------------------------------------------------
# 1) Outright deletions — weapon block is removed wholesale.
DELETIONS = [
    'smg', 'rifle', 'Sig P320', 'Beretta 92', 'M4', 'Revolver', 'Flare Gun',
    'MP7', 'Mosin', 'M16A4', 'AK47 ACOG', 'M4 Block II', 'M240', 'RPK',
    'Hailstorm Minigun', 'Kingsmaker GL', 'Widowmaker Rocket', 'Whisper Dart',
    'Stormbreaker',
]

# 2) Renames — old `name:` value -> new `name:` value. Stats untouched.
RENAMES = {
    'pistol': 'Makarov',
    'shotgun': 'Benelli M4',
    'lmg': 'M249',
    'flamethrower': 'Widowmaker Rocket Launcher',
    'Glock': 'Glock 17',
    'AKS-74U': 'UMP45',
    'P90': 'P90',                  # tag matched name; no change
    'AK47': 'AK47',                # tag matched
    'AS VAL': 'AS VAL',
    'VSS': 'VSS',
    'Snub Revolver': 'Colt Anaconda .44',
    'Desert Eagle': 'Desert Eagle .50',
    'M1911': 'M1911',
    'SVD': 'SVD Dragunov',
    'M16': 'M16',
    'Tavor': 'AUG A3-CQC',
    'AA-12': 'AA-12',
    'PKM': 'Type 80 LMG',
    'Knife': 'Combat Knife',
    'Club': 'Hammer',
}

# 3) New weapon definitions to inject from the lowpolyguns pack. Each
#    block is class-typical stats; keep them similar to in-class siblings.
#    Inserted BEFORE the closing `]` of the weapons array.
NEW_WEAPONS = [
    # --- Pistols / revolvers from lowpolyguns ---
    {
        'name': 'Colt Python', 'type': 'ranged', 'class': 'pistol', 'rarity': 'uncommon',
        'attachmentSlots': ['sideRail', 'topRail', 'grip', 'trigger'],
        'fireMode': 'semi', 'fireRate': 3.4, 'damage': 60, 'range': 38,
        'hipSpread': 0.06, 'adsSpread': 0.006,
        'adsZoom': 0.78, 'adsPeekDistance': 4.0,
        'tracerColor': 0xc8b070, 'muzzleLength': 0.62, 'muzzleGirth': 0.13,
        'pelletCount': 1, 'burstCount': 1, 'burstInterval': 0,
        'magSize': 6, 'reloadTime': 1.5,
    },
    {
        'name': 'Colt 357', 'type': 'ranged', 'class': 'pistol', 'rarity': 'common',
        'attachmentSlots': ['sideRail', 'topRail', 'grip', 'trigger'],
        'fireMode': 'semi', 'fireRate': 3.6, 'damage': 56, 'range': 36,
        'hipSpread': 0.06, 'adsSpread': 0.006,
        'adsZoom': 0.80, 'adsPeekDistance': 3.8,
        'tracerColor': 0xd0a060, 'muzzleLength': 0.55, 'muzzleGirth': 0.13,
        'pelletCount': 1, 'burstCount': 1, 'burstInterval': 0,
        'magSize': 6, 'reloadTime': 1.5,
    },
    {
        'name': '.38 Special', 'type': 'ranged', 'class': 'pistol', 'rarity': 'common',
        'attachmentSlots': ['sideRail', 'topRail', 'grip', 'trigger'],
        'fireMode': 'semi', 'fireRate': 4.2, 'damage': 38, 'range': 30,
        'hipSpread': 0.075, 'adsSpread': 0.010,
        'adsZoom': 0.84, 'adsPeekDistance': 3.2,
        'tracerColor': 0xc09060, 'muzzleLength': 0.40, 'muzzleGirth': 0.11,
        'pelletCount': 1, 'burstCount': 1, 'burstInterval': 0,
        'magSize': 6, 'reloadTime': 1.4,
    },
    {
        'name': 'Colt Six Shooter', 'type': 'ranged', 'class': 'pistol', 'rarity': 'uncommon',
        'attachmentSlots': ['grip', 'trigger'],
        'fireMode': 'semi', 'fireRate': 2.8, 'damage': 70, 'range': 34,
        'hipSpread': 0.07, 'adsSpread': 0.008,
        'adsZoom': 0.80, 'adsPeekDistance': 3.6,
        'tracerColor': 0xb87a3a, 'muzzleLength': 0.62, 'muzzleGirth': 0.12,
        'pelletCount': 1, 'burstCount': 1, 'burstInterval': 0,
        'magSize': 6, 'reloadTime': 1.8,
    },
    # --- SMGs from lowpolyguns ---
    {
        'name': 'Spectre', 'type': 'ranged', 'class': 'smg', 'rarity': 'uncommon',
        'attachmentSlots': ['muzzle', 'underRail', 'sideRail', 'topRail', 'stock', 'grip', 'magazine'],
        'fireMode': 'auto', 'fireRate': 14, 'damage': 16, 'range': 26,
        'hipSpread': 0.13, 'adsSpread': 0.028,
        'adsZoom': 0.74, 'adsPeekDistance': 4.4,
        'tracerColor': 0xc8d0e0, 'muzzleLength': 0.66, 'muzzleGirth': 0.13,
        'pelletCount': 1, 'burstCount': 1, 'burstInterval': 0,
        'magSize': 50, 'reloadTime': 1.3,
    },
    {
        'name': 'Spectre CQB', 'type': 'ranged', 'class': 'smg', 'rarity': 'common',
        'attachmentSlots': ['muzzle', 'sideRail', 'topRail', 'grip', 'magazine'],
        'fireMode': 'auto', 'fireRate': 17, 'damage': 13, 'range': 22,
        'hipSpread': 0.16, 'adsSpread': 0.038,
        'adsZoom': 0.78, 'adsPeekDistance': 4.0,
        'tracerColor': 0xb8c0d0, 'muzzleLength': 0.52, 'muzzleGirth': 0.13,
        'pelletCount': 1, 'burstCount': 1, 'burstInterval': 0,
        'magSize': 30, 'reloadTime': 1.1,
    },
    {
        'name': 'SPC9', 'type': 'ranged', 'class': 'smg', 'rarity': 'uncommon',
        'attachmentSlots': ['muzzle', 'underRail', 'sideRail', 'topRail', 'stock', 'grip', 'trigger', 'magazine'],
        'fireMode': 'auto', 'fireRate': 13, 'damage': 18, 'range': 30,
        'hipSpread': 0.12, 'adsSpread': 0.025,
        'adsZoom': 0.72, 'adsPeekDistance': 4.8,
        'tracerColor': 0xc0c8d8, 'muzzleLength': 0.74, 'muzzleGirth': 0.13,
        'pelletCount': 1, 'burstCount': 1, 'burstInterval': 0,
        'magSize': 32, 'reloadTime': 1.2,
    },
    # --- Rifles from lowpolyguns ---
    {
        'name': 'CAR-15', 'type': 'ranged', 'class': 'rifle', 'rarity': 'uncommon',
        'attachmentSlots': ['muzzle', 'barrel', 'underRail', 'sideRail', 'topRail', 'stock', 'grip', 'trigger', 'magazine'],
        'fireMode': 'auto', 'fireRate': 13, 'damage': 22, 'range': 50,
        'hipSpread': 0.10, 'adsSpread': 0.013,
        'adsZoom': 0.62, 'adsPeekDistance': 7.0,
        'tracerColor': 0xa8c0e0, 'muzzleLength': 0.78, 'muzzleGirth': 0.14,
        'pelletCount': 1, 'burstCount': 1, 'burstInterval': 0,
        'magSize': 30, 'reloadTime': 1.15,
    },
    {
        'name': 'AKS-74', 'type': 'ranged', 'class': 'rifle', 'rarity': 'uncommon',
        'attachmentSlots': ['muzzle', 'barrel', 'underRail', 'sideRail', 'topRail', 'stock', 'grip', 'trigger', 'magazine'],
        'fireMode': 'auto', 'fireRate': 10, 'damage': 28, 'range': 56,
        'hipSpread': 0.12, 'adsSpread': 0.018,
        'adsZoom': 0.58, 'adsPeekDistance': 7.0,
        'tracerColor': 0xd88848, 'muzzleLength': 0.92, 'muzzleGirth': 0.14,
        'pelletCount': 1, 'burstCount': 1, 'burstInterval': 0,
        'magSize': 30, 'reloadTime': 1.35,
    },
    {
        'name': 'AK104', 'type': 'ranged', 'class': 'rifle', 'rarity': 'rare',
        'attachmentSlots': ['muzzle', 'barrel', 'underRail', 'sideRail', 'topRail', 'stock', 'grip', 'trigger', 'magazine'],
        'fireMode': 'auto', 'fireRate': 9, 'damage': 34, 'range': 52,
        'hipSpread': 0.12, 'adsSpread': 0.020,
        'adsZoom': 0.58, 'adsPeekDistance': 7.0,
        'tracerColor': 0xe08838, 'muzzleLength': 0.86, 'muzzleGirth': 0.15,
        'pelletCount': 1, 'burstCount': 1, 'burstInterval': 0,
        'magSize': 30, 'reloadTime': 1.4,
    },
    {
        'name': 'JARD J67', 'type': 'ranged', 'class': 'rifle', 'rarity': 'rare',
        'attachmentSlots': ['muzzle', 'barrel', 'underRail', 'sideRail', 'topRail', 'grip', 'trigger', 'magazine'],
        'fireMode': 'auto', 'fireRate': 11, 'damage': 28, 'range': 60,
        'hipSpread': 0.11, 'adsSpread': 0.014,
        'adsZoom': 0.55, 'adsPeekDistance': 7.6,
        'tracerColor': 0xc0a888, 'muzzleLength': 0.82, 'muzzleGirth': 0.14,
        'pelletCount': 1, 'burstCount': 1, 'burstInterval': 0,
        'magSize': 30, 'reloadTime': 1.3,
    },
    # --- Shotguns from lowpolyguns ---
    {
        'name': 'Mossberg 500', 'type': 'ranged', 'class': 'shotgun', 'rarity': 'common',
        'attachmentSlots': ['muzzle', 'sideRail', 'topRail', 'stock', 'grip', 'magazine'],
        'fireMode': 'semi', 'fireRate': 1.3, 'damage': 14, 'range': 14,
        'hipSpread': 0.20, 'adsSpread': 0.10,
        'adsZoom': 0.85, 'adsPeekDistance': 3.4,
        'tracerColor': 0xb88858, 'muzzleLength': 0.92, 'muzzleGirth': 0.16,
        'pelletCount': 8, 'burstCount': 1, 'burstInterval': 0,
        'magSize': 6, 'reloadTime': 3.4,
    },
    {
        'name': 'Remington 870', 'type': 'ranged', 'class': 'shotgun', 'rarity': 'common',
        'attachmentSlots': ['muzzle', 'sideRail', 'topRail', 'stock', 'grip', 'magazine'],
        'fireMode': 'semi', 'fireRate': 1.4, 'damage': 14, 'range': 15,
        'hipSpread': 0.20, 'adsSpread': 0.10,
        'adsZoom': 0.85, 'adsPeekDistance': 3.4,
        'tracerColor': 0xb87a4a, 'muzzleLength': 0.95, 'muzzleGirth': 0.16,
        'pelletCount': 8, 'burstCount': 1, 'burstInterval': 0,
        'magSize': 6, 'reloadTime': 3.2,
    },
    {
        'name': 'Sawed-Off Shotgun', 'type': 'ranged', 'class': 'shotgun', 'rarity': 'common',
        'attachmentSlots': ['grip'],
        'fireMode': 'semi', 'fireRate': 1.6, 'damage': 18, 'range': 10,
        'hipSpread': 0.32, 'adsSpread': 0.18,
        'adsZoom': 0.92, 'adsPeekDistance': 2.6,
        'tracerColor': 0xa07050, 'muzzleLength': 0.5, 'muzzleGirth': 0.17,
        'pelletCount': 9, 'burstCount': 1, 'burstInterval': 0,
        'magSize': 2, 'reloadTime': 1.8,
    },
    {
        'name': 'KSG-12', 'type': 'ranged', 'class': 'shotgun', 'rarity': 'rare',
        'attachmentSlots': ['muzzle', 'sideRail', 'topRail', 'stock', 'grip'],
        'fireMode': 'semi', 'fireRate': 1.6, 'damage': 16, 'range': 16,
        'hipSpread': 0.18, 'adsSpread': 0.09,
        'adsZoom': 0.84, 'adsPeekDistance': 3.6,
        'tracerColor': 0x707880, 'muzzleLength': 0.86, 'muzzleGirth': 0.16,
        'pelletCount': 8, 'burstCount': 1, 'burstInterval': 0,
        'magSize': 14, 'reloadTime': 3.6,
    },
    # --- Snipers from lowpolyguns ---
    {
        'name': 'AWP', 'type': 'ranged', 'class': 'sniper', 'rarity': 'epic',
        'attachmentSlots': ['muzzle', 'topRail', 'stock', 'trigger', 'underRail'],
        'fireMode': 'semi', 'fireRate': 1.0, 'damage': 145, 'range': 95,
        'hipSpread': 0.15, 'adsSpread': 0.004,
        'adsZoom': 0.36, 'adsPeekDistance': 9.6,
        'tracerColor': 0xd0d0d0, 'muzzleLength': 1.45, 'muzzleGirth': 0.18,
        'pelletCount': 1, 'burstCount': 1, 'burstInterval': 0,
        'magSize': 5, 'reloadTime': 3.4,
    },
    {
        'name': '.338 Lapua', 'type': 'ranged', 'class': 'sniper', 'rarity': 'rare',
        'attachmentSlots': ['muzzle', 'barrel', 'sideRail', 'topRail', 'stock', 'grip', 'trigger', 'magazine'],
        'fireMode': 'semi', 'fireRate': 1.4, 'damage': 120, 'range': 92,
        'hipSpread': 0.14, 'adsSpread': 0.005,
        'adsZoom': 0.38, 'adsPeekDistance': 9.4,
        'tracerColor': 0xe0c080, 'muzzleLength': 1.35, 'muzzleGirth': 0.17,
        'pelletCount': 1, 'burstCount': 1, 'burstInterval': 0,
        'magSize': 5, 'reloadTime': 2.8,
    },
    {
        'name': 'Hunting Rifle', 'type': 'ranged', 'class': 'sniper', 'rarity': 'common',
        'attachmentSlots': ['muzzle', 'topRail', 'stock', 'trigger'],
        'fireMode': 'semi', 'fireRate': 1.6, 'damage': 64, 'range': 70,
        'hipSpread': 0.12, 'adsSpread': 0.008,
        'adsZoom': 0.46, 'adsPeekDistance': 8.2,
        'tracerColor': 0x9a7a4a, 'muzzleLength': 1.15, 'muzzleGirth': 0.13,
        'pelletCount': 1, 'burstCount': 1, 'burstInterval': 0,
        'magSize': 5, 'reloadTime': 2.4,
    },
    # --- Melee additions ---
    {
        'name': 'Scimitar',
        'type': 'melee', 'class': 'melee', 'rarity': 'uncommon',
        'meleeThreshold': 3.1,
        'tracerColor': 0xd8d0a8,
        'muzzleLength': 1.0, 'muzzleGirth': 0.06,
        'adsZoom': 0.78, 'adsPeekDistance': 2.8,
        'combo': '__SCIMITAR_COMBO__',  # Sentinel; replaced after JSON dump.
    },
]

SCIMITAR_COMBO_JS = '''[
        { close: { damage: 18, range: 2.2, angleDeg: 95, advance: 0.65,
                   startup: 0.05, active: 0.09, recovery: 0.18, window: 0.34, knockback: 1.8 },
          far:   { damage: 24, range: 3.1, angleDeg: 55, advance: 2.1,
                   startup: 0.08, active: 0.10, recovery: 0.22, window: 0.36, knockback: 2.2 } },
        { close: { damage: 22, range: 2.3, angleDeg: 100, advance: 0.7,
                   startup: 0.06, active: 0.10, recovery: 0.20, window: 0.36, knockback: 2.2 },
          far:   { damage: 28, range: 3.3, angleDeg: 60, advance: 2.3,
                   startup: 0.09, active: 0.11, recovery: 0.22, window: 0.36, knockback: 2.6 } },
        { close: { damage: 36, range: 2.6, angleDeg: 140, advance: 0.4,
                   startup: 0.13, active: 0.15, recovery: 0.40, window: 0.14, knockback: 5.0 },
          far:   { damage: 44, range: 3.5, angleDeg: 65, advance: 2.5,
                   startup: 0.15, active: 0.13, recovery: 0.42, window: 0.14, knockback: 5.4 } },
      ]'''


def _format_value(v, indent=6):
    pad = ' ' * indent
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        if isinstance(v, int) and v > 999:
            return hex(v)  # color values
        return str(v)
    if isinstance(v, str):
        if v == '__SCIMITAR_COMBO__':
            return SCIMITAR_COMBO_JS
        return f"'{v}'"
    if isinstance(v, list):
        items = ', '.join(_format_value(x, indent) for x in v)
        return f"[{items}]"
    raise TypeError(f"unhandled: {v!r}")


def render_weapon(w):
    lines = ['    {']
    for k, v in w.items():
        # Tracer/muzzle hex values: render as 0x-prefix hex literal.
        if k == 'tracerColor' and isinstance(v, int):
            lines.append(f'      {k}: 0x{v:06x},')
        else:
            lines.append(f'      {k}: {_format_value(v)},')
    lines.append('    },')
    return '\n'.join(lines)


def main():
    src = TUN.read_text(encoding='utf-8')
    original = src

    # 1) Renames first (safer to do before deletions reorder things).
    rename_count = 0
    for old, new in RENAMES.items():
        if old == new:
            continue
        # Match `name: 'OLD',` exactly (single-quoted, comma-terminated).
        pat = re.compile(rf"name:\s*'{re.escape(old)}'\s*,")
        new_text = f"name: '{new}',"
        src, n = pat.subn(new_text, src, count=1)
        if n:
            rename_count += 1
            print(f'  renamed {old!r} -> {new!r}')

    # 2) Deletions — find the `{` containing `name: 'X'` and remove
    #    the entire object (matching braces) including trailing comma.
    del_count = 0
    for name in DELETIONS:
        idx = _find_weapon_block(src, name)
        if idx is None:
            print(f'  ! deletion target not found: {name}')
            continue
        start, end = idx
        src = src[:start] + src[end:]
        del_count += 1
        print(f'  deleted {name!r}')

    # 3) Insertion — find the closing `]` of the weapons array and inject.
    new_blocks = '\n'.join(render_weapon(w) for w in NEW_WEAPONS) + '\n'
    src = _inject_before_weapons_close(src, new_blocks)
    print(f'  inserted {len(NEW_WEAPONS)} new weapon blocks')

    if src == original:
        print('no changes; exiting')
        return 0
    TUN.write_text(src, encoding='utf-8', newline='\n')
    print(f'\ndone. {rename_count} renames, {del_count} deletions, {len(NEW_WEAPONS)} additions.')
    return 0


def _find_weapon_block(src, name):
    """Return (start, end) byte indices of the weapon literal containing
    `name: 'X'`. The literal starts at the preceding `{` (with its
    leading whitespace) and ends after the matching `}` plus trailing
    `,\n`. None if not found."""
    pat = re.compile(rf"name:\s*'{re.escape(name)}'\s*,")
    m = pat.search(src)
    if not m:
        return None
    # Walk backward to the `{` that opens this object (skip whitespace).
    i = m.start()
    while i > 0 and src[i] != '{':
        i -= 1
    if src[i] != '{':
        return None
    # Capture the leading whitespace of the line containing `{`.
    line_start = src.rfind('\n', 0, i) + 1
    # Walk forward, brace-counting, to find the matching `}`.
    depth = 0
    j = i
    in_str = False
    str_ch = ''
    while j < len(src):
        c = src[j]
        if in_str:
            if c == '\\' and j + 1 < len(src):
                j += 2; continue
            if c == str_ch:
                in_str = False
        else:
            if c == "'" or c == '"':
                in_str = True; str_ch = c
            elif c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    j += 1
                    # Eat trailing `,\n`.
                    if j < len(src) and src[j] == ',':
                        j += 1
                    if j < len(src) and src[j] == '\n':
                        j += 1
                    return (line_start, j)
        j += 1
    return None


def _inject_before_weapons_close(src, blocks):
    """Insert `blocks` right before the closing `  ],` of the weapons
    array. The file format places this exact line at the end of the
    weapons list, so we anchor on it instead of brace-counting through
    JS strings/regex/templates."""
    # The weapons array's close line is `^  ],$` — match strictly.
    m = re.search(r'(?m)^  \],$', src)
    if not m:
        raise RuntimeError("could not find weapons array close (^  ],$)")
    return src[:m.start()] + blocks + src[m.start():]


if __name__ == '__main__':
    sys.exit(main())
