# Lightweight battle effects

PR #9 builds on the fleet artwork in #8. Merge #8 first, then retarget #9 to main if GitHub has not done so automatically.

## Player behavior

A saved cannon or creature attack produces a short source flash, traveling marks and a hit or miss cue. Bow/stern/port/starboard origins rotate with the attacker. Known hit sections rotate with the target; unknown sections use its center. Chain shot, grape, heated shot, natural attacks, breath, sonic attacks and magic have distinct color or stroke treatments. Creature AI attacks also produce a report and cue. This is an illustration of the resolved attack, not a simulation of individual projectiles; area attacks currently illustrate the primary target.

Damage, fire and crystal heat use static marks. Hidden details do not appear on contact tokens. For non-controlled participants the projected cue uses only the position/heading already exposed in the contact record; it does not export a more precise authoritative position or the hit section.

Foundry module settings → Visual battle effects (Russian UI: «Визуальные эффекты боя»):
- Обычные: up to five traveling marks, brief flash and impact, sparse wind streaks.
- Экономные: flash and result only; no traveling marks or wind.
- Выключены: instant movement, static state markers. Sound has its separate existing settings.

The setting is client-local; each participant chooses independently. OS reduced-motion disables moving cues and ambient wind. Hidden tabs, hidden narrow-layout board panes, minimized/hidden application windows and closing the app cancel the animations. Cancelled movement settles at its committed final position, rather than leaving a token halfway along its route.

## Cost and lifecycle

One active attack effect replaces any previous attack effect; no unbounded queue. At most 8 child SVG nodes (10-node safety budget), one effect RAF callback, at most 850 ms (380 ms in economy). No blur filters or idle movement on tokens. Wind count drops from 24–70 to 8–20 before LOD reduction; its per-line shadow is removed.

The animation reads a bounded snapshot in the existing saved battle report, after successful persistence. It never calls combat RNG, damage calculations, or storage. No frame updates are sent over the network. Opening a window consumes existing history without replay; IDs are remembered (bounded to 100), old events over 10 seconds are ignored, and rerenders do not restart effects. Clients with substantially different system clocks may omit cues due to that age limit; combat results remain unaffected.

## Validation and measurement

Node checks cover all source arcs at six headings for ships and creatures, target-facing hit locations, misses, finite schema fields, report persistence through normalization, and player projection for absent/lost contacts and observed positions.

Chromium exercises real controllers and application partial rendering: committed hits/misses, denied saves, duplicate renders, quality modes, reduced motion, visibility changes, narrow panes, movement cancellation, cleanup and a burst of 30 incoming events. Creature controller checks exercise both manual and AI sonic attacks.

Initial effect benchmark (Actions run 38117598988): 1.6 seconds idle and 1.6 seconds with a new effect every 200 ms, on each of 4/12/30 participants. Frame p95 stayed at 16.7–16.8 ms in both modes; each cannon cue used 6 children and replacement stayed bounded. This headless synthetic run is not a hardware FPS guarantee, a GPU paint profile, or live Foundry multiplayer validation. The separate artwork audit records the extra cost of static drawing. JSON and PNG artifacts are attached to each interface workflow run.
