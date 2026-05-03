#!/usr/bin/env bash
# Convert the _FixedRifle subset — ADS / shouldered-stance clips
# the player blends into when adsAmount > threshold. Same 8-way
# locomotion coverage as the pistol set.
set -e

SRC="Assets/models/animations/gaspfix_extracted/GaspFix"
DST="Assets/models/animations/gasp_glb"
BLENDER="/c/Program Files/Blender Foundation/Blender 5.1/blender.exe"

mkdir -p "$DST"

CLIPS=(
  "_FixedRifle/Idle/M_Neutral_Stand_Idle_Loop_Rifle.FBX"
  "_FixedRifle/Idle/M_Neutral_Crouch_Idle_Loop_Rifle.FBX"

  "_FixedRifle/Walk/M_Neutral_Walk_Loop_F_Rifle.FBX"
  "_FixedRifle/Walk/M_Neutral_Walk_Loop_B_Rifle.FBX"
  "_FixedRifle/Walk/M_Neutral_Walk_Loop_FL_Rifle.FBX"
  "_FixedRifle/Walk/M_Neutral_Walk_Loop_FR_Rifle.FBX"
  "_FixedRifle/Walk/M_Neutral_Walk_Loop_BL_Rifle.FBX"
  "_FixedRifle/Walk/M_Neutral_Walk_Loop_BR_Rifle.FBX"

  "_FixedRifle/Run/M_Neutral_Run_Loop_F_Rifle.FBX"
  "_FixedRifle/Run/M_Neutral_Run_Loop_B_Rifle.FBX"
  "_FixedRifle/Run/M_Neutral_Run_Loop_FL_Rifle.FBX"
  "_FixedRifle/Run/M_Neutral_Run_Loop_FR_Rifle.FBX"
  "_FixedRifle/Run/M_Neutral_Run_Loop_BL_Rifle.FBX"
  "_FixedRifle/Run/M_Neutral_Run_Loop_BR_Rifle.FBX"

  "_FixedRifle/Crouch/M_Neutral_Crouch_Loop_F_Rifle.FBX"
  "_FixedRifle/Crouch/M_Neutral_Crouch_Loop_FL_Rifle.FBX"
  "_FixedRifle/Crouch/M_Neutral_Crouch_Loop_FR_Rifle.FBX"
)

i=1
TOTAL=${#CLIPS[@]}
for REL in "${CLIPS[@]}"; do
  FBX="$SRC/$REL"
  if [ ! -f "$FBX" ]; then
    echo "[skip $i/$TOTAL] not found: $REL"
    i=$((i + 1))
    continue
  fi
  NAME=$(basename "$REL" .FBX)
  OUT="$DST/$NAME.glb"
  if [ -f "$OUT" ]; then
    echo "[skip $i/$TOTAL] $NAME (already converted)"
    i=$((i + 1))
    continue
  fi
  echo "[$i/$TOTAL] $NAME"
  "$BLENDER" --background --python "tools/blender-fbx-to-glb.py" -- \
      --in "$FBX" \
      --out "$OUT" \
      --strip-root-motion \
      --scale 0.01 2>&1 | grep -E "(WROTE|stripped|imported|ERROR)" || true
  i=$((i + 1))
done

echo ""
echo "[done] $(ls -1 "$DST" | grep _Rifle | wc -l) rifle GLBs in $DST"
