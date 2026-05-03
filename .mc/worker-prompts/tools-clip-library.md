Author tools/clip_library.html — a rig + clip browser for the modular animation system.

Reference files: tools/rig_compose.html (boot pattern), tools/rig_tuner.html (existing tool styles), src/anim/registry.js (Registry.create / registry.rig(id)), src/anim/state_machine.js, src/character_fbx.js.

The tool should:

1. Use the boot pattern from tools/rig_compose.html (importmap with three@0.161, OrbitControls, scene+camera+renderer, anchored panel on the right).
2. Drop-down to pick a rigId from Assets/anim_data/rigs/*.json (read via Registry.create then registry.rig(id)).
3. After rig pick, dropdown to pick a clip pack URL (default: 'Assets/models/animations/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb').
4. Load the rig + pack via loadCharacterFBX + loadAnimationFBX from src/character_fbx.js.
5. List all clip names returned by rig.clipNames(). Click a clip to play it via rig.play(clipName).
6. Below the list, a small form to TAG the selected clip — choose tags from { locomotion, walk, run, idle, aim, fire, reload, melee }, choose scope from { full, upper, lower, top, bottom }, choose loop boolean, set referenceSpeed number.
7. 'Copy clip metadata JSON to clipboard' button — produces an Assets/anim_data/clips/<rigId>/<clipName>.json file matching the L2 schema in the plan: { clipName, source, tags[], scope, loop, referenceSpeed, additive boolean }.
8. No editing of the clip itself — just metadata authoring. Round-trip via clipboard, NOT direct file write.

Pure HTML+ESM file at tools/clip_library.html. Reuse existing styles from tools/rig_compose.html. Single page, single panel.
