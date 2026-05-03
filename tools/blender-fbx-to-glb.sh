#!/usr/bin/env bash
# Unix wrapper — calls Blender 5.1 in background mode with the
# conversion script. Pass-through args.

BLENDER="/c/Program Files/Blender Foundation/Blender 5.1/blender.exe"
if [ ! -f "$BLENDER" ]; then
  BLENDER="$(command -v blender || true)"
fi
if [ -z "$BLENDER" ]; then
  echo "[blender-fbx-to-glb] ERROR: Blender not found" >&2
  exit 1
fi

# --background = no UI, -- splits Blender args from our args
"$BLENDER" --background --python "tools/blender-fbx-to-glb.py" -- "$@"
