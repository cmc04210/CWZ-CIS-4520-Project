# Pumpkin Chunkin

An 8-bit style trebuchet-building game. Pick materials, tune the machine, and
launch pumpkins of different sizes past the goal flag.

No build step and no dependencies: open `index.html` in a browser, or serve
the folder with any static file server (for example
`python3 -m http.server 8765` and visit http://localhost:8765/).

## How to play

- **Career** – eight levels, each with a pumpkin size, a goal distance, a
  budget, and sometimes a weight limit. Reach the goal to unlock the next
  level; beat it by 20% / 40% for two and three stars.
- **Free play** – no budget, every pumpkin size, chase your personal best.

Controls: arrow keys navigate and adjust, Enter/Space confirms and launches,
Esc goes back, hold Space during a throw to fast-forward, M toggles sound.
Everything is also clickable.

### What you can change

| Parameter | Effect |
|---|---|
| Frame (pine / oak / steel) | Max load it can hold before collapsing; weight; cost |
| Arm (pine / oak / aluminum / carbon) | Max bending load before snapping; arm weight (a heavy arm wastes energy) |
| Long arm | Tip speed and axle height |
| Short arm | How far the counterweight drops, and the bending load on the arm |
| Counterweight | Stored energy (fixed or hinged mount; hinged drops further) |
| Latex bands | Elastic power, very light but expensive |
| Sling length | Longer slings whip later and faster, until they drag |
| Release pin | Bigger angle releases earlier for a higher arc |
| Wheels | Let the frame roll during the throw |

Heavy pumpkins like a low pin angle; light ones like a high one. Overload the
frame or the arm and the machine breaks on launch.

## Under the hood

`js/physics.js` is a small generalized-coordinate rigid-body simulation (arm
angle, counterweight hanger angle, sling angle, and frame position when on
wheels). Each substep it builds the mass matrix and generalized forces
numerically and solves for the accelerations, so the behaviour of the sling,
hinged counterweight, bands, ground contact, and wheels is emergent rather than
scripted. After release the pumpkin flies ballistically with quadratic drag,
which is why a one-pound pumpkin stops gaining range long before a fifteen
pound one does.

The physics module runs headless in Node as well, which is how the level
targets were calibrated:

```bash
node -e "require('./js/data.js'); require('./js/physics.js');
const cfg = Object.assign({}, PC.DEFAULT_BUILD, { cwLb: 300, longArm: 10, shortArm: 3, hinged: 'hinged' });
console.log(PC.Physics.runToEnd(cfg, PC.findById(PC.PUMPKINS, 'medium'), PC.computeBuild(cfg)));"
```

Files:

- `js/data.js` – materials, pumpkins, parameters, levels, cost/weight/strength rules
- `js/physics.js` – the trebuchet simulation
- `js/render.js` – palette, pixel primitives, scenery, trebuchet drawing
- `js/font.js` – 5x7 bitmap font
- `js/audio.js` – Web Audio chiptune effects
- `js/game.js` – states, UI, input, save data (localStorage), main loop
