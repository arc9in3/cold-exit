# Cold Exit — art style memory

This file is read automatically by Mission Control's art pipeline before every gen request for this project. Edit freely — it's just instructions for the prompt normalizer.

## Default asset type: UI ICON

Unless the request explicitly says otherwise (e.g. "splash art", "environment tile", "character portrait"), assume the asset is a UI icon for the cold-exit browser game:

- **Single isolated subject**, centered, no character sheet, no multi-angle reference, no comparison panels.
- **Transparent background** (the pipeline strips backgrounds via rembg automatically — but design with a neutral solid background that's easy to mask).
- **Clean readable silhouette** at small sizes (32x32 to 128x128 final UI sizes). Bold shapes, high contrast, no fine detail that disappears at 32px.
- **No text, watermarks, captions, borders, or labels** in the image.
- **Style: clean game-UI illustration**, slightly stylized, not photorealistic. Think Diablo / Path of Exile inventory icon density.

## Asset categories used in this project

- **UI icons** (most common) — inventory items, abilities, status effects, currencies. Single subject, square aspect, designed for 32-128px display.
- **Enemy / item sprites** — single isolated 2D character or object, designed for in-world rendering.
- **Character portraits** — bust framing, 512x768 or similar tall ratio.
- **Environment tiles** — seamless or near-seamless 512x512.
- **Splash / promo** — full 1024x1024, treated as one-off marketing assets.

If the request mentions one of these explicitly, follow that instead of the default.

## Color and mood

- Palette: muted, slightly desaturated. Think hostile-extraction-shooter atmosphere — utility over flash.
- Avoid: cartoon-bright primaries, anime saturation, cute mascot energy.

## Things that have gone wrong before

- Models defaulting to character-sheet / multi-view layouts when asked for a single subject. The pipeline now enforces "single subject" but it's worth being extra-explicit in prompts that benefit.
- Outputs with hard backgrounds when transparency was needed. Fixed via auto-rembg, but design with a neutral background to give rembg the cleanest signal.
- Outputs with embedded text labels or watermarks. The enforcement suffix forbids this; flag if it slips through.
