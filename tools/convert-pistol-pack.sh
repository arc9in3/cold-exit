#!/usr/bin/env bash
# Batch-convert the Motus pistol-pack FBX clips to GLB. Run from
# the repo root. Outputs side-by-side under
# Assets/models/animations/FBX_Pistol_Starter_27A_glb/.
set -e

SRC="Assets/models/animations/FBX_Pistol_Starter_27A/Animation"
DST="Assets/models/animations/FBX_Pistol_Starter_27A_glb"
BLENDER="/c/Program Files/Blender Foundation/Blender 5.1/blender.exe"

mkdir -p "$DST"

# Walk every .fbx under the pack and emit a matching .glb at the
# top of $DST. Sub-directories collapse — clip names are unique.
find "$SRC" -type f -name "*.fbx" | while read -r FBX; do
    NAME=$(basename "$FBX" .fbx)
    OUT="$DST/$NAME.glb"
    if [ -f "$OUT" ]; then
        echo "[skip] $NAME (already converted)"
        continue
    fi
    echo "[convert] $NAME"
    "$BLENDER" --background --python "tools/blender-fbx-to-glb.py" -- \
        --in  "$FBX" \
        --out "$OUT" \
        --strip-root-motion \
        --scale 0.01 \
        2>&1 | grep -E "(WROTE|stripped|ERROR|imported)" || true
done

echo "[done] $(ls -1 "$DST" | wc -l) GLB files in $DST"
