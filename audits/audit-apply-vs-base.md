# audit-apply-vs-base

Model: `deepseek-r1:32b`
Generated: 2026-04-28T00:20:05.987Z
Files in scope (2): `src/artifacts.js`, `src/skills.js`

## Prompt

In src/skills.js, BASE_STATS() returns the stat bag with every field the runtime uses. In src/artifacts.js, each artifact's apply(s) function mutates fields on that bag. Walk every apply(s) in artifacts.js. For each field it touches (s.someField), confirm BASE_STATS() declares that field. Any apply that touches an UNDECLARED field silently no-ops because nothing else in the runtime sees the mutation. Output a numbered list with file:line for each violation. End with 'Risk: <none|low|medium|high>' and 'Suggested fix:'.

## Report
1. src/artifacts.js:130 - `regenCapImmune` (artifact `innocent_heart`)  
2. src/artifacts.js:146 - `dashDistanceMult` (artifact `rocket_shoes`)  
3. src/artifacts.js:257 - `openingActActive` (artifact `opening_act`)  
4. src/artifacts.js:268 - `magnumOpusActive` (artifact `magnum_opus`)  
5. src/artifacts.js:390 - `dervishSlowRadius` and `dervishSlowDuration` (artifact `dervish_prayer`)  
6. src/artifacts.js:415 - `meleeReflectBleedPercent` (artifact `thread_cuts`)  
7. src/artifacts.js:427 - `oneInChamberActive` (artifact `bloody_mag`)  

Risk: medium  
Suggested fix: Add missing fields to BASE_STATS() or adjust artifacts to use declared fields.
