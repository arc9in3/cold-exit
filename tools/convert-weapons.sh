#!/usr/bin/env bash
# Convert every weapon / melee / accessory FBX to GLB. Output is
# side-by-side under <category>/<file>.glb so the runtime can swap
# extension without changing the path layout.
set -e

BLENDER="/c/Program Files/Blender Foundation/Blender 5.1/blender.exe"
DIRS=(
  "Assets/models/weapons"
  "Assets/models/lowpolyguns"
  "Assets/models/lowpolyguns_accessories"
  "Assets/models/melee"
  "Assets/models/medical"
  "Assets/models/tools"
)

count=0
for DIR in "${DIRS[@]}"; do
  if [ ! -d "$DIR" ]; then continue; fi
  while IFS= read -r FBX; do
    NAME=$(basename "$FBX")
    NAME_NOEXT="${NAME%.*}"
    OUT="$DIR/$NAME_NOEXT.glb"
    if [ -f "$OUT" ]; then
      continue
    fi
    count=$((count + 1))
    echo "[$count] $NAME"
    # Weapons are inanimate props — no animation, no scale stripping.
    # Use --scale 1.0 (most weapon FBXes are already in meters).
    "$BLENDER" --background --python "tools/blender-fbx-to-glb.py" -- \
      --in "$FBX" --out "$OUT" --scale 1.0 \
      2>&1 | grep -E "(WROTE|ERROR)" || true
  done < <(find "$DIR" -maxdepth 1 -type f \( -name "*.fbx" -o -name "*.FBX" \) | sort)
done

echo ""
echo "[done] converted $count weapon files"
