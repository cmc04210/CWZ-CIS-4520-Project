/* Game data: materials, pumpkins, build parameters, levels, and the
   cost/weight/strength bookkeeping shared by the workshop UI and the sim. */
var PC = (typeof window !== 'undefined') ? (window.PC = window.PC || {}) : (global.PC = global.PC || {});

(function (PC) {
  'use strict';

  PC.PUMPKINS = [
    { id: 'mini',   name: 'MINI',   lb: 1,  inches: 4 },
    { id: 'small',  name: 'SMALL',  lb: 4,  inches: 6.5 },
    { id: 'medium', name: 'MEDIUM', lb: 8,  inches: 8.5 },
    { id: 'large',  name: 'LARGE',  lb: 15, inches: 10.5 },
    { id: 'giant',  name: 'GIANT',  lb: 30, inches: 13.5 }
  ];

  // Frame weight scales with axle height. maxLoad is the total downward pull
  // (counterweight + band force, lbf) the frame survives.
  PC.FRAMES = [
    { id: 'pine',  name: 'PINE',  lbPerFt: 7,  maxLoad: 500,  cost: 40,  color: 15, dark: 23 },
    { id: 'oak',   name: 'OAK',   lbPerFt: 12, maxLoad: 1300, cost: 90,  color: 23, dark: 22 },
    { id: 'steel', name: 'STEEL', lbPerFt: 22, maxLoad: 6000, cost: 180, color: 24, dark: 25 }
  ];

  // Arm weight scales with total arm length. maxMoment is the bending load
  // (pull in lbf x short arm in ft) the arm survives.
  PC.ARMS = [
    { id: 'pine',   name: 'PINE',     lbPerFt: 2.2, maxMoment: 900,  costPerFt: 3,  color: 15, dark: 23 },
    { id: 'oak',    name: 'OAK',      lbPerFt: 3.0, maxMoment: 1900, costPerFt: 5,  color: 23, dark: 22 },
    { id: 'alu',    name: 'ALUMINUM', lbPerFt: 1.4, maxMoment: 3200, costPerFt: 10, color: 7,  dark: 8 },
    { id: 'carbon', name: 'CARBON',   lbPerFt: 0.7, maxMoment: 6500, costPerFt: 20, color: 8,  dark: 0 }
  ];

  PC.BAND   = { lb: 0.5, cost: 45, lbf: 50 };   // per latex band, lbf at full cock
  PC.WHEELS = { lb: 20, cost: 30 };
  PC.HINGE  = { lb: 6, cost: 20 };
  PC.CW_COST_PER_LB = 0.25;

  PC.PARAMS = [
    { key: 'frame',    label: 'FRAME',        type: 'choice', options: PC.FRAMES },
    { key: 'arm',      label: 'ARM',          type: 'choice', options: PC.ARMS },
    { key: 'longArm',  label: 'LONG ARM',     type: 'num', min: 6, max: 16, step: 1,  unit: 'FT' },
    { key: 'shortArm', label: 'SHORT ARM',    type: 'num', min: 1, max: 5,  step: 0.5, unit: 'FT' },
    { key: 'cwLb',     label: 'COUNTERWEIGHT', type: 'num', min: 0, max: 2000, step: 25, unit: 'LB' },
    { key: 'hinged',   label: 'CW MOUNT',     type: 'choice', options: [{ id: 'fixed', name: 'FIXED' }, { id: 'hinged', name: 'HINGED' }] },
    { key: 'bands',    label: 'LATEX BANDS',  type: 'num', min: 0, max: 16, step: 1, unit: '' },
    { key: 'slingPct', label: 'SLING LENGTH', type: 'num', min: 50, max: 130, step: 5, unit: '%' },
    { key: 'release',  label: 'RELEASE PIN',  type: 'num', min: 5, max: 90, step: 5, unit: 'DEG' },
    { key: 'wheels',   label: 'WHEELS',       type: 'choice', options: [{ id: 'off', name: 'OFF' }, { id: 'on', name: 'ON' }] }
  ];

  PC.DEFAULT_BUILD = {
    frame: 'pine', arm: 'pine', longArm: 8, shortArm: 2, cwLb: 100,
    hinged: 'fixed', bands: 0, slingPct: 90, release: 30, wheels: 'off'
  };

  PC.LEVELS = [
    { name: 'THE BACKYARD',    pumpkin: 'small',  target: 80,  budget: 150,  maxWeight: null,
      tip: 'A LITTLE PINE MACHINE WILL DO. TRY A SLING AROUND 90% AND A 45 DEG PIN.' },
    { name: 'COUNTY FAIR',     pumpkin: 'medium', target: 150, budget: 260,  maxWeight: null,
      tip: 'HEAVIER PUMPKINS NEED MORE COUNTERWEIGHT. WATCH THE ARM LOAD.' },
    { name: 'BIG AIR',         pumpkin: 'mini',   target: 280, budget: 300,  maxWeight: null,
      tip: 'A LIGHT PUMPKIN WANTS A LIGHT ARM. A HINGED COUNTERWEIGHT IS MORE EFFICIENT.' },
    { name: 'HEAVYWEIGHT',     pumpkin: 'large',  target: 220, budget: 480,  maxWeight: null,
      tip: 'OAK OR STEEL FRAMES HOLD MORE WEIGHT. LONG ARMS NEED STRONG MATERIALS.' },
    { name: 'FEATHERWEIGHT',   pumpkin: 'mini',   target: 510, budget: 700,  maxWeight: 100,
      tip: 'THE WHOLE MACHINE MUST WEIGH UNDER 100 LB. GRAVITY WILL NOT GET YOU THERE...' },
    { name: 'THE GIANT',       pumpkin: 'giant',  target: 300, budget: 900,  maxWeight: null,
      tip: 'A 30 LB PUMPKIN. BRING SERIOUS COUNTERWEIGHT AND A FRAME THAT CAN HOLD IT.' },
    { name: 'LONG SHOT',       pumpkin: 'medium', target: 520, budget: 1300, maxWeight: null,
      tip: 'WHEELS LET THE FRAME ROLL AND ADD RANGE. TUNE THE PIN AND SLING TOGETHER.' },
    { name: 'WORLD RECORD',    pumpkin: 'large',  target: 600, budget: 2500, maxWeight: null,
      tip: 'EVERYTHING YOU HAVE LEARNED. CARBON ARM, STEEL FRAME, HINGED, WHEELS.' }
  ];

  PC.findById = function (list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0];
  };

  PC.axleHeightFt = function (cfg) {
    // Tall enough that the cocked arm tip (45 deg down) clears the trough.
    return 0.7071 * cfg.longArm + 1.6;
  };

  // Everything the UI needs to show about a build and everything the sim
  // needs that is not a raw parameter.
  PC.computeBuild = function (cfg) {
    var frame = PC.findById(PC.FRAMES, cfg.frame);
    var arm = PC.findById(PC.ARMS, cfg.arm);
    var H = PC.axleHeightFt(cfg);
    var armLen = cfg.longArm + cfg.shortArm;
    var hinged = cfg.hinged === 'hinged';
    var wheels = cfg.wheels === 'on';

    var frameLb = frame.lbPerFt * H;
    var armLb = arm.lbPerFt * armLen;
    var bandsLb = cfg.bands * PC.BAND.lb;
    var weightLb = frameLb + armLb + cfg.cwLb + bandsLb + (wheels ? PC.WHEELS.lb : 0) + (hinged ? PC.HINGE.lb : 0);

    var cost = frame.cost + arm.costPerFt * armLen + cfg.cwLb * PC.CW_COST_PER_LB +
      cfg.bands * PC.BAND.cost + (wheels ? PC.WHEELS.cost : 0) + (hinged ? PC.HINGE.cost : 0);

    var pull = cfg.cwLb + cfg.bands * PC.BAND.lbf;
    var frameLoad = pull;
    var armMoment = pull * cfg.shortArm;

    return {
      frame: frame, arm: arm, axleHeightFt: H,
      frameLb: frameLb, armLb: armLb, weightLb: weightLb,
      cost: Math.round(cost),
      frameLoad: frameLoad, frameMax: frame.maxLoad, frameOK: frameLoad <= frame.maxLoad,
      armLoad: armMoment, armMax: arm.maxMoment, armOK: armMoment <= arm.maxMoment,
      hasPower: pull > 0,
      hinged: hinged, wheels: wheels
    };
  };

  PC.cloneBuild = function (b) {
    var o = {};
    for (var k in b) o[k] = b[k];
    return o;
  };
})(PC);
