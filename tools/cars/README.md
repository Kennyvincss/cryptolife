# Car model pipeline

Converts third-party car glTFs into the game's car format (see `src/entities/carmodel.ts`):

1. `carrun.mjs cars.json export` drives `index.html` + `proc.js` in headless Chromium (via the Vite dev server for `three`).
   It loads each model (Draco), orients it (+Z forward, ground at y=0, real length), finds the four wheels
   (circular ground-touching parts), detects the paint colour, splits the front doors along clean seam planes,
   and exports `body_*`, `doorL_*`, `doorR_*` and `wheel_*` meshes plus wheel/seat/door metadata in extras.
2. `carlod.mjs in.raw.glb near.glb far.glb 22000 1600 3500` welds, simplifies (meshoptimizer) and
   meshopt-compresses a near and a far level of detail.

Paths inside the scripts point at a local scratch folder; adjust them before re-running.
