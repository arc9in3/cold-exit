Author tools/state_machine.html — a visual state-machine editor for Assets/anim_data/states/<id>.json files.

Reference files: tools/rig_compose.html (boot pattern), Assets/anim_data/states/cold_exit_player.json (sample SM), src/anim/state_machine.js (selectFromPlayerState).

The tool should:

1. Use the boot pattern from tools/rig_compose.html.
2. Load an existing SM JSON via fetch (default 'Assets/anim_data/states/cold_exit_player.json'). Show a textarea where the user can edit the JSON directly.
3. Below the textarea, a 'Validate' button that parses the JSON and reports: (a) per-layer state count, (b) any selectionPriority entries referencing nonexistent state names, (c) total state index size (must be ≤256 for u8 net sync).
4. A 'Preview live' button that imports loadCharacterFBX from src/character_fbx.js + the state_machine module + selectFromPlayerState. Drive a single rig with a small playerState fed by sliders (speed 0..6, ads 0..1, crouched bool, swinging bool). Show which state was picked + the clip name overlaid on the canvas.
5. 'Copy JSON to clipboard' button to round-trip back to the source file.

Pure HTML+ESM file at tools/state_machine.html. Reuse existing styles from tools/rig_compose.html. Single page, single panel.
