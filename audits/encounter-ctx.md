This audit identifies `ctx.showPrompt` as a helper used by encounters in `src/encounters.js` that is not formally exposed in the `_ctxFactory` in `src/main.js`. While currently only used within the `interact` method (where it is manually added to the `ctx` object), this inconsistency creates a brittle system that could lead to crashes if `showPrompt` were ever called from `tick` or `onItemDropped` in an encounter.

### Inconsistency

*   **File:** `src/main.js`, `src/encounters.js`
*   **Problem:** The `showPrompt` helper is used by multiple encounters in `src/encounters.js` (e.g., `fortune_teller`, `shrine`, `whispering_door`, `the_button`, `the_tome`, `the_lamp`, `curse_breaker`, `sus`, `priest`) but is not explicitly defined within the `_ctxFactory` function in `src/main.js`. It is instead manually added to the `ctx` object within the `tryInteract` function in `src/main.js` before calling `enc.def.interact(ctx)`.
*   **Suggested fix:** Add `showPrompt: showEncounterPrompt` and `closePrompt: closeEncounterPrompt` to the `_ctxFactory` definition in `src/main.js` to ensure consistent exposure of the helper to all encounter contexts.

**What was checked but came back clean:**

*   `ctx.spendCredits`: The `GEMINI.md` file mentioned `ctx.spendCredits` as an anti-pattern. However, no instances of `ctx.spendCredits` were found in `src/encounters.js`; all credit spending uses `ctx.spendPlayerCredits`, which is correctly exposed by `_ctxFactory`.
*   `ctx.state`: The `state` object is correctly passed to `tick` and `onItemDropped` functions by `tickEncounters` and `tryEncounterItemDrop` respectively.
*   `ctx.spawnSpeechBubble` and `ctx.room2`: No usage found in `src/encounters.js`.
