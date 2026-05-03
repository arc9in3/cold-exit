@echo off
REM Cold Exit asset conversion wrapper — FBX → GLB via Blender 5.1.
REM
REM Usage:
REM   tools\blender-fbx-to-glb.bat ^
REM     --in  "Assets\models\animations\FBX_Pistol_Starter_27A\...\W1_Stand_Idle.fbx" ^
REM     --out "Assets\models\animations\FBX_Pistol_Starter_27A_glb\W1_Stand_Idle.glb" ^
REM     --strip-root-motion --scale 0.01
REM
REM All args after the script name are passed straight through to
REM tools/blender-fbx-to-glb.py. See that file's docstring for the
REM full flag list.

setlocal
set BLENDER="C:\Program Files\Blender Foundation\Blender 5.1\blender.exe"
if not exist %BLENDER% (
    echo [blender-fbx-to-glb] ERROR: Blender not found at %BLENDER%
    exit /b 1
)

REM --background = no UI, --python = run our script, -- = pass-through marker
%BLENDER% --background --python "tools\blender-fbx-to-glb.py" -- %*
exit /b %ERRORLEVEL%
