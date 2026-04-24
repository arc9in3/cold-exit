#!/usr/bin/env python3
"""Extract .fbx (and optional .png textures) from animpic POLY Unity packs.

These packs ship as outer `.zip` wrappers containing a `.unitypackage` — a
gzipped tar of GUID-folders each holding the original source asset (`.fbx`,
`.png`, `.mat`, `.prefab`) plus a `pathname` file recording the in-project
path. We care about the `.fbx` meshes; Three.js loads them directly via
FBXLoader.

Examples:
    python unity_to_gltf.py --src Assets/poly_survivalmeleeweapons.zip --list
    python unity_to_gltf.py --src Assets/poly_survivalmeleeweapons.zip --out Assets/models/melee
    python unity_to_gltf.py --src Assets/poly_megaweaponskit.zip --filter "Pistol|Rifle"

Requires: Python standard library only (zipfile + tarfile).
"""
import argparse, io, re, sys, tarfile, tempfile, shutil, zipfile
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True,
                    help='Path to a POLY .zip wrapper or a raw .unitypackage')
    ap.add_argument('--out', default='Assets/models',
                    help='Output directory (default Assets/models)')
    ap.add_argument('--filter', default=None,
                    help='Regex matched against the asset pathname (case-insensitive)')
    ap.add_argument('--include-textures', action='store_true',
                    help='Also extract .png textures alongside .fbx files')
    ap.add_argument('--list', action='store_true',
                    help='Print asset pathnames without extracting')
    args = ap.parse_args()

    src = Path(args.src)
    if not src.exists():
        print(f'No such path: {src}', file=sys.stderr); sys.exit(1)

    pattern = re.compile(args.filter, re.IGNORECASE) if args.filter else None
    out_root = Path(args.out); out_root.mkdir(parents=True, exist_ok=True)

    unitypackage, cleanup_dir = _resolve_unitypackage(src)
    try:
        kinds = ('.fbx',) + (('.png',) if args.include_textures else ())
        listed = extracted = skipped = 0

        with tarfile.open(unitypackage, 'r:gz') as tf:
            groups = _group_by_guid(tf)
            for guid, entries in groups.items():
                pathname_m = entries.get('pathname')
                asset_m = entries.get('asset')
                if not pathname_m or not asset_m:
                    continue
                pathname = tf.extractfile(pathname_m).read().decode('utf-8', errors='replace').splitlines()[0].strip()
                ext = ('.' + pathname.rsplit('.', 1)[-1].lower()) if '.' in pathname else ''
                if ext not in kinds:
                    continue
                if pattern and not pattern.search(pathname):
                    continue

                if args.list:
                    print(pathname); listed += 1; continue

                try:
                    payload = tf.extractfile(asset_m).read()
                    name = Path(pathname).stem
                    safe = re.sub(r'[^A-Za-z0-9_\-]+', '_', name)
                    out_path = out_root / f'{safe}{ext}'
                    out_path.write_bytes(payload)
                    print(f'{pathname}  ->  {out_path}')
                    extracted += 1
                except Exception as e:
                    print(f'[skip] {pathname}: {e}', file=sys.stderr)
                    skipped += 1

        if args.list:
            print(f'\n{listed} matched')
        else:
            print(f'\n{extracted} extracted, {skipped} skipped')

    finally:
        if cleanup_dir:
            shutil.rmtree(cleanup_dir, ignore_errors=True)


def _resolve_unitypackage(src):
    """Return (path_to_unitypackage, temp_dir_to_cleanup_or_None)."""
    if src.suffix.lower() == '.unitypackage':
        return src, None

    if src.suffix.lower() == '.zip':
        tmp = tempfile.mkdtemp(prefix='unity_extract_')
        with zipfile.ZipFile(src) as zf:
            zf.extractall(tmp)
        up = next(Path(tmp).rglob('*.unitypackage'), None)
        if up is None:
            shutil.rmtree(tmp, ignore_errors=True)
            print(f'No .unitypackage found inside {src}', file=sys.stderr)
            sys.exit(1)
        return up, tmp

    print(f'Unsupported source type: {src.suffix}', file=sys.stderr)
    sys.exit(1)


def _group_by_guid(tf):
    """Group tar members into { guid: { 'pathname': m, 'asset': m, 'asset.meta': m } }."""
    groups = {}
    for m in tf.getmembers():
        if not m.isfile(): continue
        parts = m.name.split('/')
        if len(parts) < 2: continue
        guid, fname = parts[0], parts[-1]
        groups.setdefault(guid, {})[fname] = m
    return groups


if __name__ == '__main__':
    main()
