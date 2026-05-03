#!/usr/bin/env bash
# Generate one-handed pistol locomotion variants from the GASP
# _FixedPistol clip set. Off-hand (left arm) gets a procedural
# natural-swing pose; main hand stays as the clip authored it.
set -e

BLENDER="/c/Program Files/Blender Foundation/Blender 5.1/blender.exe"
SRC="Assets/models/animations/gaspfix_extracted/GaspFix/_FixedPistol"
DST="Assets/models/animations/gasp_glb"
mkdir -p "$DST"

CLIPS=(
  "Idle/M_Neutral_Stand_Idle_Loop_Pistol"
  "Idle/M_Neutral_Crouch_Idle_Loop_Pistol"
  "Walk/M_Neutral_Walk_Loop_F_Pistol"
  "Walk/M_Neutral_Walk_Loop_B_Pistol"
  "Walk/M_Neutral_Walk_Loop_FL_Pistol"
  "Walk/M_Neutral_Walk_Loop_FR_Pistol"
  "Walk/M_Neutral_Walk_Loop_BL_Pistol"
  "Walk/M_Neutral_Walk_Loop_BR_Pistol"
  "Run/M_Neutral_Run_Loop_F_Pistol"
  "Run/M_Neutral_Run_Loop_B_Pistol"
  "Run/M_Neutral_Run_Loop_FL_Pistol"
  "Run/M_Neutral_Run_Loop_FR_Pistol"
  "Run/M_Neutral_Run_Loop_BL_Pistol"
  "Run/M_Neutral_Run_Loop_BR_Pistol"
  "Sprint/M_Neutral_Sprint_Loop_F_Pistol"
  "Crouch/M_Neutral_Crouch_Loop_F_Pistol"
  "Crouch/M_Neutral_Crouch_Loop_B_Pistol"
  "Crouch/M_Neutral_Crouch_Loop_FL_Pistol"
  "Crouch/M_Neutral_Crouch_Loop_FR_Pistol"
  "Crouch/M_Neutral_Crouch_Loop_BL_Pistol"
  "Crouch/M_Neutral_Crouch_Loop_BR_Pistol"
)

i=1
TOTAL=${#CLIPS[@]}
for REL in "${CLIPS[@]}"; do
  IN="$SRC/$REL.FBX"
  if [ ! -f "$IN" ]; then
    echo "[skip $i/$TOTAL] not found: $REL"
    i=$((i + 1))
    continue
  fi
  NAME=$(basename "$REL")
  # Insert _OneHand before the trailing _Pistol so naming sorts cleanly.
  OUT_NAME="${NAME%_Pistol}_OneHand_Pistol.glb"
  OUT="$DST/$OUT_NAME"
  if [ -f "$OUT" ]; then
    echo "[skip $i/$TOTAL] $OUT_NAME (already converted)"
    i=$((i + 1))
    continue
  fi
  echo "[$i/$TOTAL] $OUT_NAME"
  "$BLENDER" --background --python tools/blender-onehand-pistol.py -- \
    --in "$IN" --out "$OUT" --scale 0.01 --off-side l \
    2>&1 | grep -E "(WROTE|ERROR|imported|removed|authored)" || true
  i=$((i + 1))
done

echo ""
echo "[done] $(ls "$DST" | grep _OneHand_Pistol | wc -l) one-handed clips in $DST"
