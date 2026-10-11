# Fleet artwork and direction audit

PR #8 redraws the tactical board with six ship families (cutter, schooner, brig, frigate, line, bomb) and five creature silhouettes (bird, ray, jelly, swarm, beast). Ships and creatures share the +X artwork axis; game heading 0 is north, increasing clockwise. SVG rotation is heading − 90. Port is local −Y, starboard +Y. Wind direction is the destination, consistent with the sailing engine.

Cosmetic SM scaling never changes occupied cells, collision or range. Labels and status rows stay upright and move clear of larger artwork. Unidentified contacts retain a generic marker and constant size. Creature image orientation is selected in the editor; existing images default to right to preserve prior behavior.

## Rendering

Artwork uses shared SVG definitions with per-token use instances, without raster textures, idle motion or blur. Fine detail is hidden at distant camera zoom. Single-class paint selectors are intentional: ancestor-dependent selectors do not reliably style SVG use shadow trees in Chromium. Color was visually verified in the 66-case gallery.

## Checks

- Node: all six headings and both column parities match the next actual hex; four image orientations; source direction of wind; ship and creature arc agreement; scale and contact privacy.
- Chromium: production templates and movement controller, upright labels, all 66 silhouette/course combinations, existing interface/workspace/movement/gunnery/crew/pacing suites.
- Artifacts in the interface-preview workflow artifact: fleet-directions.png, fleet-board.png, artwork-performance.json.
- Foundry window and persistence APIs are stubbed in the browser harness; a live Foundry multiplayer/hardware test is still separate.

## Measurement

Same GitHub Chromium runner, production application code, swapping only old/main vs new board template and CSS; 12 board renders (2 warmups removed), then 90 frame intervals per population. Baseline commit: a5d805b74bb38dcc2f9277f7ed74be984bb9dfb9.

Measured after the color fix in Actions run 38117376501:

| Participants | Old median board render | New median board render | Old / new frame p95 |
| --- | --- | --- | --- |
| 4 | 5.3 ms | 8.8 ms | 16.8 / 16.8 ms |
| 12 | 6.1 ms | 7.6 ms | 33.3 / 33.2 ms |
| 30 | 11.2 ms | 14.7 ms | 33.3 / 33.3 ms |

The new static artwork costs approximately 1.5–3.5 ms more per board render in this run. It adds shared definitions (+126 SVG DOM nodes at 4 units, +100 at 30); repeated tokens use fewer nodes than before. This is not a promise of unchanged FPS. Runner scheduling varies; frame intervals include the existing ambient wind animation and are not GPU paint measurements. The effects follow-up reduces ambient wind and adds client-local quality controls.
