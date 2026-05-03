#!/usr/bin/env bash
# Convert the ESSENTIAL subset of the GaspFix pack — the 8-direction
# loop cycles for Walk/Run/Sprint/Crouch + idle + the UEFN mannequin
# mesh. These cover the user's request: forward + backpedal blends
# across jog/run/crouch/sneak with directional rotation.
#
# Naming convention:
#   M_Neutral_<Mode>_Loop_<DIR>_Pistol.FBX
#   DIR ∈ { F, B, L, R, FL, FR, BL, BR }   — 8 cardinal/diagonal
#
# We focus on _Pistol variants (player default weapon class). Rifle
# variants are queued separately.
set -e

SRC="Assets/models/animations/gaspfix_extracted/GaspFix"
DST="Assets/models/animations/gasp_glb"
BLENDER="/c/Program Files/Blender Foundation/Blender 5.1/blender.exe"

mkdir -p "$DST"

# UEFN mannequin mesh (the rig + skeleton).
echo "[1/N] mannequin mesh"
"$BLENDER" --background --python "tools/blender-fbx-to-glb.py" -- \
    --in "$SRC/Characters/UEFN_Mannequin/Meshes/SKM_UEFN_Mannequin.FBX" \
    --out "$DST/SKM_UEFN_Mannequin.glb" \
    --strip-root-motion \
    --scale 0.01 2>&1 | grep -E "(WROTE|stripped|imported|ERROR)" || true

# Idle loops + idle breaks
ESSENTIALS=(
  "_FixedPistol/Idle/M_Neutral_Stand_Idle_Loop_Pistol.FBX"
  "_FixedPistol/Idle/M_Neutral_Crouch_Idle_Loop_Pistol.FBX"
  "_FixedPistol/Idle/M_Neutral_Stand_Idle_Break_v01_Pistol.FBX"

  # Walk — 8-way directional loop cycles
  "_FixedPistol/Walk/M_Neutral_Walk_Loop_F_Pistol.FBX"
  "_FixedPistol/Walk/M_Neutral_Walk_Loop_B_Pistol.FBX"
  "_FixedPistol/Walk/M_Neutral_Walk_Loop_L_Pistol.FBX"
  "_FixedPistol/Walk/M_Neutral_Walk_Loop_R_Pistol.FBX"
  "_FixedPistol/Walk/M_Neutral_Walk_Loop_FL_Pistol.FBX"
  "_FixedPistol/Walk/M_Neutral_Walk_Loop_FR_Pistol.FBX"
  "_FixedPistol/Walk/M_Neutral_Walk_Loop_BL_Pistol.FBX"
  "_FixedPistol/Walk/M_Neutral_Walk_Loop_BR_Pistol.FBX"

  # Run — same 8-way
  "_FixedPistol/Run/M_Neutral_Run_Loop_F_Pistol.FBX"
  "_FixedPistol/Run/M_Neutral_Run_Loop_B_Pistol.FBX"
  "_FixedPistol/Run/M_Neutral_Run_Loop_L_Pistol.FBX"
  "_FixedPistol/Run/M_Neutral_Run_Loop_R_Pistol.FBX"
  "_FixedPistol/Run/M_Neutral_Run_Loop_FL_Pistol.FBX"
  "_FixedPistol/Run/M_Neutral_Run_Loop_FR_Pistol.FBX"
  "_FixedPistol/Run/M_Neutral_Run_Loop_BL_Pistol.FBX"
  "_FixedPistol/Run/M_Neutral_Run_Loop_BR_Pistol.FBX"

  # Sprint — 8-way (sprint-back is rare so OK if missing)
  "_FixedPistol/Sprint/M_Neutral_Sprint_Loop_F_Pistol.FBX"
  "_FixedPistol/Sprint/M_Neutral_Sprint_Loop_B_Pistol.FBX"
  "_FixedPistol/Sprint/M_Neutral_Sprint_Loop_L_Pistol.FBX"
  "_FixedPistol/Sprint/M_Neutral_Sprint_Loop_R_Pistol.FBX"

  # Crouch — 8-way for sneak/cover
  "_FixedPistol/Crouch/M_Neutral_Crouch_Loop_F_Pistol.FBX"
  "_FixedPistol/Crouch/M_Neutral_Crouch_Loop_B_Pistol.FBX"
  "_FixedPistol/Crouch/M_Neutral_Crouch_Loop_FL_Pistol.FBX"
  "_FixedPistol/Crouch/M_Neutral_Crouch_Loop_FR_Pistol.FBX"
  "_FixedPistol/Crouch/M_Neutral_Crouch_Loop_BL_Pistol.FBX"
  "_FixedPistol/Crouch/M_Neutral_Crouch_Loop_BR_Pistol.FBX"

  # Jump (3-phase: start, fall, land)
  "_FixedPistol/Jump/M_Neutral_Jump_Loop_Fall_Pistol.FBX"
)

i=2
TOTAL=$((${#ESSENTIALS[@]} + 1))
for REL in "${ESSENTIALS[@]}"; do
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
echo "[done] $(ls -1 "$DST" | wc -l) GLBs in $DST"
ls -1 "$DST"
