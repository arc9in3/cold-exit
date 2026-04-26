#!/usr/bin/env python3
"""
Apply real-world-spec stats to weapons in src/tunables.js. Each entry
in OVERRIDES is a dict of { fieldName: value } applied to the matching
weapon block (matched by `name: 'X'`).

Stats sourced from common references for each platform — caliber
energy informs damage, cyclic RPM/60 informs fireRate, barrel length
informs range and ADS spread, magazine capacity is the real-world
factory spec.

Game-side caps:
  ROOM_M = 14m. Class range buckets in main.js fire path:
    shotgun 7m  · smg 12m  · rifle 21m  · lmg 17m  · pistol/sniper 100m
  These ceilings are independent of the per-weapon `range` field
  (which gates raycast travel). Damage falloff is by class.
"""
import re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
TUN  = ROOT / 'src' / 'tunables.js'

# Each value is a dict of literal scalar overrides applied via regex
# in-place (one field at a time). Numeric values render verbatim;
# string values become quoted; bools render as true/false.
OVERRIDES = {
    # === Pistols ===
    # Makarov 9×18 PM, 8-rd, 3.7" barrel — weak service round.
    'Makarov': dict(damage=28, fireRate=4.0, range=28, magSize=8, reloadTime=1.0,
                    hipSpread=0.075, adsSpread=0.011),
    # Glock 17 9×19, 17-rd, 4.5" barrel.
    'Glock 17': dict(damage=32, fireRate=5.0, range=34, magSize=17, reloadTime=0.9,
                     hipSpread=0.07, adsSpread=0.008),
    # M1911 .45 ACP, 7-rd, 5" barrel — heavy round, slower follow-up.
    'M1911': dict(damage=52, fireRate=4.0, range=34, magSize=7, reloadTime=1.1,
                  hipSpread=0.068, adsSpread=0.007),
    # Colt Anaconda .44 Mag, 6-rd, 6-8" barrel — strong wheelgun.
    'Colt Anaconda .44': dict(damage=82, fireRate=2.6, range=38, magSize=6, reloadTime=2.0,
                              hipSpread=0.06, adsSpread=0.005),
    # Desert Eagle .50 AE, 7-rd, 6" barrel.
    'Desert Eagle .50': dict(damage=110, fireRate=2.4, range=42, magSize=7, reloadTime=1.5,
                             hipSpread=0.085, adsSpread=0.006),
    # Colt Python .357 Mag, 6-rd, 6" vent rib — premium revolver.
    'Colt Python': dict(damage=64, fireRate=3.2, range=40, magSize=6, reloadTime=1.7,
                        hipSpread=0.058, adsSpread=0.005),
    # Colt 357 Mag, 6-rd, 4-6".
    'Colt 357': dict(damage=58, fireRate=3.4, range=36, magSize=6, reloadTime=1.7,
                     hipSpread=0.06, adsSpread=0.006),
    # .38 Special snub, 6-rd, 2".
    '.38 Special': dict(damage=34, fireRate=4.0, range=24, magSize=6, reloadTime=1.6,
                        hipSpread=0.085, adsSpread=0.012),
    # Single-action frontier revolver, 6-rd, 4.75-7.5".
    'Colt Six Shooter': dict(damage=58, fireRate=2.4, range=32, magSize=6, reloadTime=2.4,
                             hipSpread=0.07, adsSpread=0.007),

    # === SMGs ===
    # UMP45 — .45 ACP, 25-rd, 600 RPM cyclic.
    'UMP45': dict(damage=22, fireRate=10, range=28, magSize=25, reloadTime=1.6,
                  hipSpread=0.13, adsSpread=0.026),
    # P90 — 5.7×28, 50-rd, 900 RPM, AP characteristics.
    'P90': dict(damage=14, fireRate=15, range=30, magSize=50, reloadTime=1.5,
                hipSpread=0.12, adsSpread=0.024),
    # Spectre M4 — 9mm, 50-rd, 850 RPM.
    'Spectre': dict(damage=16, fireRate=14, range=26, magSize=50, reloadTime=1.4,
                    hipSpread=0.13, adsSpread=0.028),
    # Spectre CQB — short barrel, 30-rd, ~1000 RPM.
    'Spectre CQB': dict(damage=13, fireRate=17, range=22, magSize=30, reloadTime=1.2,
                        hipSpread=0.16, adsSpread=0.038),
    # SPC9 — 9mm PCC, 32-rd, 800 RPM.
    'SPC9': dict(damage=18, fireRate=13, range=32, magSize=32, reloadTime=1.3,
                 hipSpread=0.11, adsSpread=0.022),
    # PDW (kept name) — pistol-cal carbine baseline.
    'PDW': dict(damage=15, fireRate=14, range=28, magSize=30, reloadTime=1.3,
                hipSpread=0.13, adsSpread=0.028),

    # === Rifles ===
    # AK47 — 7.62×39, 30-rd, 600 RPM.
    'AK47': dict(damage=32, fireRate=10, range=58, magSize=30, reloadTime=1.6,
                 hipSpread=0.12, adsSpread=0.018),
    # AKS-74 — 5.45×39, 30-rd, 650 RPM.
    'AKS-74': dict(damage=26, fireRate=11, range=58, magSize=30, reloadTime=1.4,
                   hipSpread=0.10, adsSpread=0.014),
    # AK104 — short-barrel 7.62×39, 30-rd, 600 RPM.
    'AK104': dict(damage=30, fireRate=10, range=48, magSize=30, reloadTime=1.5,
                  hipSpread=0.12, adsSpread=0.020),
    # AS VAL — 9×39 SP, 30-rd, 900 RPM. Integrally suppressed.
    'AS VAL': dict(damage=32, fireRate=15, range=50, magSize=30, reloadTime=1.3,
                   hipSpread=0.10, adsSpread=0.014, suppressedByDefault=True),
    # VSS — 9×39 semi DMR, 10-rd, ~250 RPM cyclic but used semi.
    'VSS': dict(damage=58, fireRate=4.0, range=72, magSize=10, reloadTime=1.6,
                hipSpread=0.08, adsSpread=0.007, suppressedByDefault=True),
    # M16 — 5.56, 30-rd, 800 RPM, 20" barrel.
    'M16': dict(damage=26, fireRate=12, range=70, magSize=30, reloadTime=1.4,
                hipSpread=0.09, adsSpread=0.011),
    # AUG A3-CQC — 5.56 bullpup, 30-rd, 680 RPM, 14-16".
    'AUG A3-CQC': dict(damage=26, fireRate=11, range=60, magSize=30, reloadTime=1.3,
                       hipSpread=0.10, adsSpread=0.013),
    # CAR-15 — 5.56, 30-rd, 800 RPM, 14" barrel.
    'CAR-15': dict(damage=22, fireRate=13, range=52, magSize=30, reloadTime=1.2,
                   hipSpread=0.10, adsSpread=0.014),
    # JARD J67 — straight-pull bullpup, 18" barrel, semi-auto only.
    'JARD J67': dict(damage=42, fireRate=4.5, range=72, magSize=10, reloadTime=1.5,
                     hipSpread=0.08, adsSpread=0.007, fireMode='semi'),

    # === LMGs ===
    # Type 80 LMG — 7.62×54R belt, 100-rd, 700 RPM.
    'Type 80 LMG': dict(damage=36, fireRate=12, range=65, magSize=100, reloadTime=4.5,
                        hipSpread=0.22, adsSpread=0.028),
    # M249 — 5.56 belt, 200-rd box, 800 RPM. Use 200-mag to read as box.
    'M249': dict(damage=24, fireRate=13, range=60, magSize=200, reloadTime=4.8,
                 hipSpread=0.20, adsSpread=0.024),

    # === Snipers ===
    'Remington 700': dict(damage=72, fireRate=1.3, range=80, magSize=5, reloadTime=2.4,
                          hipSpread=0.13, adsSpread=0.005),
    'SVD Dragunov': dict(damage=78, fireRate=4.0, range=82, magSize=10, reloadTime=2.4,
                         hipSpread=0.10, adsSpread=0.005),
    'Cheytac Intervention': dict(damage=210, fireRate=0.8, range=100, magSize=7, reloadTime=4.0,
                                  hipSpread=0.18, adsSpread=0.003),
    'AWP': dict(damage=145, fireRate=1.0, range=95, magSize=5, reloadTime=3.4,
                hipSpread=0.15, adsSpread=0.004),
    '.338 Lapua': dict(damage=130, fireRate=1.4, range=92, magSize=5, reloadTime=3.0,
                       hipSpread=0.14, adsSpread=0.005),
    'Hunting Rifle': dict(damage=66, fireRate=1.4, range=72, magSize=5, reloadTime=2.4,
                          hipSpread=0.12, adsSpread=0.008),

    # === Shotguns ===
    # AA-12 — 300 RPM full-auto, 8-rd drum, 12 ga.
    'AA-12': dict(damage=14, fireRate=5.0, range=18, magSize=8, reloadTime=3.5,
                  hipSpread=0.20, adsSpread=0.10, pelletCount=8, fireMode='auto'),
    # Benelli M4 — 12 ga semi-auto, 7-rd tube.
    'Benelli M4': dict(damage=15, fireRate=3.0, range=18, magSize=7, reloadTime=3.0,
                       hipSpread=0.20, adsSpread=0.10, pelletCount=8, fireMode='semi'),
    # Mossberg 500 — 12 ga pump, 6-rd tube.
    'Mossberg 500': dict(damage=15, fireRate=1.4, range=16, magSize=6, reloadTime=3.4,
                         hipSpread=0.20, adsSpread=0.10, pelletCount=8),
    # Remington 870 — 12 ga pump, 6-rd tube.
    'Remington 870': dict(damage=15, fireRate=1.4, range=17, magSize=6, reloadTime=3.2,
                          hipSpread=0.20, adsSpread=0.10, pelletCount=8),
    # Sawed-Off — 12 ga break-action, 2-rd, terrible spread / range / great pellet count.
    'Sawed-Off Shotgun': dict(damage=18, fireRate=1.6, range=10, magSize=2, reloadTime=2.0,
                              hipSpread=0.34, adsSpread=0.20, pelletCount=10),
    # KSG-12 — 12 ga pump bullpup, 14-rd dual tube.
    'KSG-12': dict(damage=16, fireRate=1.6, range=18, magSize=14, reloadTime=4.0,
                   hipSpread=0.18, adsSpread=0.09, pelletCount=8),

    # === Exotic ===
    # Widowmaker rocket launcher — keep mythic-class blast stats.
    'Widowmaker Rocket Launcher': dict(damage=5, fireRate=0.6, range=80, magSize=2, reloadTime=4.0),
}


def _format(v):
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, str):
        return f"'{v}'"
    raise TypeError(v)


def _block_bounds(src, name):
    """Return (start, end) of the weapon literal whose `name:` matches."""
    pat = re.compile(rf"name:\s*'{re.escape(name)}'\s*,")
    m = pat.search(src)
    if not m:
        return None
    i = m.start()
    while i > 0 and src[i] != '{':
        i -= 1
    if src[i] != '{':
        return None
    depth = 0; j = i; in_str = False; ch = ''
    while j < len(src):
        c = src[j]
        if in_str:
            if c == '\\' and j + 1 < len(src):
                j += 2; continue
            if c == ch:
                in_str = False
        else:
            if c in ("'", '"'):
                in_str = True; ch = c
            elif c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    return (i, j + 1)
        j += 1
    return None


def _set_field(block, field, value):
    """Replace `field: <anything>,` inside `block`. If the field is
    missing, append it just before the closing `}` (preserves indent).
    Returns the new block text."""
    rendered = _format(value)
    pat = re.compile(rf"(\b{re.escape(field)}:\s*)([^,\n}}]+)(,?)")
    m = pat.search(block)
    if m:
        return block[:m.start()] + f"{m.group(1)}{rendered}{m.group(3) or ','}" + block[m.end():]
    # Insert just before final `}`.
    close = block.rfind('}')
    insert = f"      {field}: {rendered},\n"
    return block[:close] + insert + block[close:]


def main():
    src = TUN.read_text(encoding='utf-8')
    edits = 0
    for name, fields in OVERRIDES.items():
        bounds = _block_bounds(src, name)
        if not bounds:
            print(f'! not found: {name}')
            continue
        start, end = bounds
        block = src[start:end]
        for k, v in fields.items():
            block = _set_field(block, k, v)
        src = src[:start] + block + src[end:]
        edits += 1
        print(f'  restatted {name}')
    TUN.write_text(src, encoding='utf-8', newline='\n')
    print(f'\ndone. {edits} weapons restatted.')


if __name__ == '__main__':
    main()
