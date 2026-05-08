@echo off
REM Convert Mixamo melee FBX files dropped in
REM   Assets\models\animations\_mixamo_inbox\
REM into GLB clips at
REM   Assets\models\animations\runner_glb\melee\
REM
REM Expected filenames in the inbox (rename when downloading from
REM mixamo.com OR rename after download):
REM
REM   swing-1.fbx     - light/fast swing (combo step 1)
REM   swing-2.fbx     - medium swing    (combo step 2)
REM   swing-3.fbx     - heavy/finisher  (combo step 3)
REM   quick-jab.fbx   - gun pistol-whip / rifle-butt jab
REM
REM Each is converted to runner_glb\melee\<name>.glb with root motion
REM stripped (game position is driven by physics; clip translations
REM only ever fight that). FBX is moved to a _converted\ subfolder
REM so reruns skip already-processed files.
REM
REM Usage:
REM   tools\convert-melee-inbox.bat
REM
REM Re-run safe: skips files already moved to _converted\.

setlocal enabledelayedexpansion
set INBOX=Assets\models\animations\_mixamo_inbox
set OUTDIR=Assets\models\animations\runner_glb\melee
set CONVERTED=%INBOX%\_converted

if not exist %INBOX% (
    echo [convert-melee] ERROR: inbox missing: %INBOX%
    exit /b 1
)
if not exist %OUTDIR% mkdir %OUTDIR%
if not exist %CONVERTED% mkdir %CONVERTED%

set ANY=0
for %%F in ("%INBOX%\swing-1.fbx" "%INBOX%\swing-2.fbx" "%INBOX%\swing-3.fbx" "%INBOX%\quick-jab.fbx") do (
    if exist %%F (
        set ANY=1
        set SRC=%%~F
        set NAME=%%~nF
        set DST=%OUTDIR%\!NAME!.glb
        echo.
        echo [convert-melee] !NAME!.fbx ^-^> !DST!
        call tools\blender-fbx-to-glb.bat --in "!SRC!" --out "!DST!" --strip-root-motion --scale 0.01
        if errorlevel 1 (
            echo [convert-melee] ERROR converting !NAME!.fbx
        ) else (
            move "!SRC!" "%CONVERTED%\!NAME!.fbx" > nul
            echo [convert-melee] OK -- moved source to %CONVERTED%\
        )
    )
)
if !ANY! equ 0 (
    echo [convert-melee] no melee FBX files found in %INBOX%
    echo Drop swing-1.fbx / swing-2.fbx / swing-3.fbx / quick-jab.fbx there.
)
echo.
echo [convert-melee] done.
exit /b 0
