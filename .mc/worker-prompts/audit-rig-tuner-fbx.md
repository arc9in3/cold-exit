Audit-only (read+report, no code edits). Outline the changes needed to extend tools/rig_tuner.html to support FBX/GLB rigs in addition to its current procgen-only rig.

Reference files: tools/rig_tuner.html (current procgen-only tool), src/character_fbx.js (FBX/GLB loader, registry-aware as of Phase 1), src/anim/registry.js (rig configs eager-loaded by id).

The audit should produce a plan with:

1. Which sections of tools/rig_tuner.html currently assume the rig is procgen (search for buildRig calls, rig.dims slider bindings, hard-coded part names like 'leftArm.shoulder.pivot').
2. Where the FBX/GLB load path would be added — a separate 'rig source' dropdown above the existing dim sliders, populated from Assets/anim_data/rigs/*.json.
3. Which tuner controls work as-is on FBX/GLB rigs (pose presets — drive transforms by code-side leftArm/rightArm refs which exist on FBX rigs after the registry refactor) vs which need adapting (dim sliders — FBX bones don't have authored DIMS, those are procgen-specific).
4. A migration ordering: what to wire first, what to defer.

Output as audits/rig-tuner-fbx-extension-plan.md. Read-only audit, NO code edits.
