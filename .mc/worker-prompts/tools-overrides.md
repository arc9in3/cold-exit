Author tools/overrides.html — character overrides editor for Assets/anim_data/overrides/<id>.json files.

Reference files: tools/rig_compose.html (boot pattern), Assets/anim_data/overrides/eve.json (sample), src/anim/overrides.js (applyOverrides + resolvePropAttachment).

The tool should:

1. Use the boot pattern from tools/rig_compose.html.
2. Load a target character via loadComposedCharacter from src/anim/rig_compose.js OR loadCharacterFBX from src/character_fbx.js depending on whether rig_compose/<id>.json exists.
3. Sliders / color pickers for: materials.body.tintHex, materials.top.tintHex, materials.bottom.tintHex. Apply live to the rig via applyOverrides from src/anim/overrides.js.
4. Prop attachment authoring: pick a propId (text input), pick a bone from a dropdown of rig._fbx.bonesByName.keys(), drag-style xyz + rpy pose offsets. Show a small placeholder mesh (e.g. a green cube) attached at the configured pose so the user can see where the prop will sit.
5. 'Copy overrides JSON to clipboard' button — produces the L5 schema: { props{}, materials{}, boneOffsets{} }.

Pure HTML+ESM file at tools/overrides.html. Reuse existing styles from tools/rig_compose.html.
