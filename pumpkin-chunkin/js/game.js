/* Game state machine, UI, input, save data, main loop. */
var PC = (typeof window !== 'undefined') ? (window.PC = window.PC || {}) : (global.PC = global.PC || {});

(function (PC) {
  'use strict';

  var R = PC.Render, C = R.C, F = PC.Font, Au = PC.Audio;
  var W = R.W, H = R.H, FT = PC.Physics.FT;
  var ctx;
  var SAVE_KEY = 'pumpkinChunkinSave_v1';

  var state = 'title';
  var time = 0;
  var mode = 'career';
  var levelIdx = 0;
  var save = loadSave();
  var build = PC.cloneBuild(PC.DEFAULT_BUILD);
  var freePumpkin = 'small';
  var ws = { sel: 0, msg: null, msgT: 0 };
  var launch = null;
  var titleSim = null;
  var menuSel = 0;
  var levelSel = 0;

  var input = {
    held: {}, heldSince: {}, repeatAt: {},
    pressed: [], mouse: { x: -1, y: -1, clicked: false, down: false }, hits: []
  };

  // ---- Save ---------------------------------------------------------------
  function loadSave() {
    try {
      var s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (s && s.levels) return s;
    } catch (e) { /* ignore */ }
    return { levels: {}, builds: {}, freeBest: {}, freeBuild: null };
  }
  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
  }
  function levelStars(i) { return (save.levels[i] && save.levels[i].stars) || 0; }
  function levelBest(i) { return (save.levels[i] && save.levels[i].best) || 0; }
  function isUnlocked(i) { return i === 0 || levelStars(i - 1) > 0; }

  // ---- Input --------------------------------------------------------------
  function keyName(e) {
    var k = e.key;
    if (k === ' ') return 'Space';
    if (k.length === 1) return k.toUpperCase();
    return k;
  }
  function onKeyDown(e) {
    var k = keyName(e);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].indexOf(k) >= 0) e.preventDefault();
    if (!input.held[k]) {
      input.held[k] = true; input.heldSince[k] = time; input.repeatAt[k] = time + 0.4;
      input.pressed.push(k);
    }
    Au.unlock();
  }
  function onKeyUp(e) { var k = keyName(e); input.held[k] = false; }
  function pressed(k) { return input.pressed.indexOf(k) >= 0; }
  // Auto-repeat for held arrow keys
  function repeat(k) {
    if (!input.held[k]) return false;
    if (time >= input.repeatAt[k]) { input.repeatAt[k] = time + 0.06; return true; }
    return false;
  }
  function hit(x, y, w, h, fn, tag) { input.hits.push({ x: x, y: y, w: w, h: h, fn: fn, tag: tag }); }
  function hovered(x, y, w, h) {
    var m = input.mouse; return m.x >= x && m.x < x + w && m.y >= y && m.y < y + h;
  }

  // ---- Helpers ------------------------------------------------------------
  function currentLevel() { return mode === 'career' ? PC.LEVELS[levelIdx] : null; }
  function currentPumpkin() {
    var lv = currentLevel();
    return PC.findById(PC.PUMPKINS, lv ? lv.pumpkin : freePumpkin);
  }
  function paramList() {
    var list = PC.PARAMS.slice();
    if (mode === 'free') list.unshift({ key: 'pumpkin', label: 'PUMPKIN', type: 'choice', options: PC.PUMPKINS });
    return list;
  }
  function getVal(p) { return p.key === 'pumpkin' ? freePumpkin : build[p.key]; }
  function setVal(p, v) { if (p.key === 'pumpkin') freePumpkin = v; else build[p.key] = v; }
  function adjust(p, dir) {
    if (p.type === 'choice') {
      var i = p.options.indexOf(PC.findById(p.options, getVal(p)));
      var ni = i + dir;
      if (ni < 0 || ni >= p.options.length) { Au.deny(); return; }
      setVal(p, p.options[ni].id);
    } else {
      var v = getVal(p) + dir * p.step;
      if (v < p.min - 1e-9 || v > p.max + 1e-9) { Au.deny(); return; }
      setVal(p, Math.round(v * 100) / 100);
    }
    Au.tick();
    storeBuild();
  }
  function storeBuild() {
    if (mode === 'career') save.builds[levelIdx] = PC.cloneBuild(build);
    else { save.freeBuild = PC.cloneBuild(build); save.freePumpkin = freePumpkin; }
    persist();
  }
  function restoreBuild() {
    var b = mode === 'career' ? save.builds[levelIdx] : save.freeBuild;
    build = b ? PC.cloneBuild(b) : PC.cloneBuild(PC.DEFAULT_BUILD);
    if (mode === 'free' && save.freePumpkin) freePumpkin = save.freePumpkin;
    for (var k in PC.DEFAULT_BUILD) if (build[k] === undefined) build[k] = PC.DEFAULT_BUILD[k];
  }
  function fmt(n, d) { return (Math.round(n * Math.pow(10, d || 0)) / Math.pow(10, d || 0)).toString(); }
  function starsFor(dist, lv) {
    if (dist >= lv.target * 1.4) return 3;
    if (dist >= lv.target * 1.2) return 2;
    if (dist >= lv.target) return 1;
    return 0;
  }
  function canLaunch(b, lv) {
    if (!b.hasPower) return 'NO POWER: ADD COUNTERWEIGHT OR BANDS';
    if (lv && b.cost > lv.budget) return 'OVER BUDGET';
    if (lv && lv.maxWeight && b.weightLb > lv.maxWeight) return 'MACHINE TOO HEAVY';
    return null;
  }

  // ---- State transitions --------------------------------------------------
  function goTitle() { state = 'title'; menuSel = 0; ensureTitleSim(); }
  function goLevels() { state = 'levels'; levelSel = Math.min(levelIdx, PC.LEVELS.length - 1); }
  function goIntro(i) { levelIdx = i; mode = 'career'; state = 'intro'; }
  function goWorkshop() { restoreBuild(); state = 'workshop'; ws.sel = 0; ws.msg = null; }
  function goFree() { mode = 'free'; goWorkshop(); }

  function ensureTitleSim() {
    var cfg = PC.cloneBuild(PC.DEFAULT_BUILD);
    cfg.longArm = 10; cfg.shortArm = 2.5; cfg.cwLb = 300; cfg.hinged = 'hinged'; cfg.frame = 'oak'; cfg.arm = 'oak';
    titleSim = PC.Physics.createSim(cfg, PC.findById(PC.PUMPKINS, 'medium'), PC.computeBuild(cfg));
  }

  function startLaunch() {
    var lv = currentLevel();
    var pumpkin = currentPumpkin();
    var b = PC.computeBuild(build);
    var why = canLaunch(b, lv);
    if (why) { ws.msg = why; ws.msgT = time; Au.deny(); return; }
    var sim = PC.Physics.createSim(build, pumpkin, b);
    var cam = R.makeCamera();
    var s0 = Math.min((W * 0.5) / (sim.Ll * 1.9 + sim.Ls * 2.2), (H * 0.68) / (sim.H + sim.Ll * 0.9 + 0.5));
    cam.s = s0; cam.x = sim.Ll * 0.15; cam.y = 0;
    launch = {
      sim: sim, cam: cam, s0: s0, build: b, pumpkin: pumpkin, level: lv,
      frameFail: !b.frameOK, armFail: b.frameOK && !b.armOK,
      collapseT: 0, splat: null, result: null, released: false, shake: 0, fast: false, t: 0
    };
    if (launch.armFail) sim.scheduleSnap(0.22);
    state = 'launch';
    Au.launch();
  }

  function finishLaunch() {
    var L = launch, dist = L.frameFail ? 0 : L.sim.distanceFt;
    var res = { dist: dist, stars: 0, newBest: false, apex: L.sim.apexFt || 0, v: L.sim.releaseV * 3.281, ang: L.sim.releaseAngleDeg };
    if (L.level) {
      res.stars = starsFor(dist, L.level);
      var rec = save.levels[levelIdx] || { stars: 0, best: 0 };
      if (dist > rec.best) { rec.best = Math.round(dist); res.newBest = true; }
      rec.stars = Math.max(rec.stars, res.stars);
      save.levels[levelIdx] = rec;
    } else {
      var fb = save.freeBest[L.pumpkin.id] || 0;
      if (dist > fb) { save.freeBest[L.pumpkin.id] = Math.round(dist); res.newBest = true; }
    }
    persist();
    L.result = res;
    if (L.level) { if (res.stars > 0) Au.fanfare(res.stars); else Au.sad(); }
    else Au.fanfare(res.newBest ? 2 : 0);
  }

  // ---- Update -------------------------------------------------------------
  function update(dt) {
    time += dt;
    switch (state) {
      case 'title': updateTitle(dt); break;
      case 'levels': updateLevels(); break;
      case 'intro': updateIntro(); break;
      case 'workshop': updateWorkshop(); break;
      case 'launch': updateLaunch(dt); break;
      case 'help': if (pressed('Escape') || pressed('Enter') || pressed('Space')) { Au.back(); goTitle(); } break;
    }
    if (pressed('M')) { var m = Au.toggleMute(); ws.msg = m ? 'SOUND OFF' : 'SOUND ON'; ws.msgT = time; }
  }

  function updateTitle(dt) {
    if (titleSim) {
      if (titleSim.done) { if (!titleSim.restartAt) titleSim.restartAt = time + 1.5; if (time > titleSim.restartAt) ensureTitleSim(); }
      else if (time > 1.0) titleSim.step(Math.min(dt, 1 / 30));
    }
    var items = 3;
    if (pressed('ArrowDown')) { menuSel = (menuSel + 1) % items; Au.move(); }
    if (pressed('ArrowUp')) { menuSel = (menuSel + items - 1) % items; Au.move(); }
    if (pressed('Enter') || pressed('Space')) { Au.select(); titleChoose(menuSel); }
  }
  function titleChoose(i) {
    if (i === 0) goLevels();
    else if (i === 1) goFree();
    else state = 'help';
  }

  function updateLevels() {
    var n = PC.LEVELS.length;
    if (pressed('ArrowRight')) { levelSel = (levelSel + 1) % n; Au.move(); }
    if (pressed('ArrowLeft')) { levelSel = (levelSel + n - 1) % n; Au.move(); }
    if (pressed('ArrowDown')) { levelSel = (levelSel + 4) % n; Au.move(); }
    if (pressed('ArrowUp')) { levelSel = (levelSel + n - 4) % n; Au.move(); }
    if (pressed('Enter') || pressed('Space')) {
      if (isUnlocked(levelSel)) { Au.select(); goIntro(levelSel); } else Au.deny();
    }
    if (pressed('Escape')) { Au.back(); goTitle(); }
  }

  function updateIntro() {
    if (pressed('Enter') || pressed('Space')) { Au.select(); goWorkshop(); }
    if (pressed('Escape')) { Au.back(); goLevels(); }
  }

  function updateWorkshop() {
    var list = paramList();
    if (pressed('ArrowDown')) { ws.sel = (ws.sel + 1) % list.length; Au.move(); }
    if (pressed('ArrowUp')) { ws.sel = (ws.sel + list.length - 1) % list.length; Au.move(); }
    var p = list[ws.sel];
    if (pressed('ArrowLeft') || repeat('ArrowLeft')) adjust(p, -1);
    if (pressed('ArrowRight') || repeat('ArrowRight')) adjust(p, 1);
    if (pressed('Space') || pressed('Enter')) startLaunch();
    if (pressed('Escape')) { Au.back(); if (mode === 'career') goLevels(); else goTitle(); }
  }

  function updateLaunch(dt) {
    var L = launch, sim = L.sim, cam = L.cam;
    L.fast = !!input.held['Space'] && !L.result;
    var simDt = Math.min(dt, 1 / 30) * (L.fast ? 4 : 1);
    L.t += simDt;

    if (L.frameFail) {
      L.collapseT += simDt;
      L.shake = Math.max(0, 1 - L.collapseT) * 3;
      if (L.collapseT === simDt) Au.crack();
      if (L.collapseT > 2.2 && !L.result) finishLaunch();
    } else {
      var wasReleased = sim.released, wasLanded = sim.landed;
      sim.step(simDt);
      if (sim.released && !wasReleased) { Au.release(); if (sim.snapped) { Au.crack(); L.shake = 3; } }
      if (sim.landed && !wasLanded) {
        Au.splat(); L.shake = 2;
        L.splat = { x: sim.proj.x, r: sim.pr * 2.5 };
      }
      if (sim.done && !L.result) finishLaunch();
    }
    L.shake *= 0.85;

    // Camera
    var pp = sim.pumpkinPos();
    var tx, ty, ts;
    if (!sim.released) { tx = sim.Ll * 0.15 + (sim.wheels ? sim.points.named.A.x : 0); ty = 0; ts = L.s0; }
    else {
      var py = Math.max(0, pp.y);
      ts = Math.min(L.s0, 140 / Math.max(py, 2), 2600 / Math.max(pp.x, 30));
      ts = Math.max(ts, 0.9);
      tx = pp.x + (W * 0.2) / ts;
      ty = Math.max(0, py - 140 / ts);
      if (sim.landed) { tx = pp.x; ty = 0; ts = Math.max(ts, 3); }
    }
    var k = sim.landed ? 0.08 : 0.15;
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k; cam.s += (ts - cam.s) * k;

    if (L.result) {
      if (pressed('R')) { Au.select(); startLaunch(); }
      if (pressed('W') || pressed('Escape')) { Au.back(); state = 'workshop'; }
      if (pressed('N') || pressed('Enter')) {
        if (L.level && L.result.stars > 0 && levelIdx + 1 < PC.LEVELS.length) { Au.select(); goIntro(levelIdx + 1); }
        else if (L.level) { Au.select(); goLevels(); }
        else { Au.back(); state = 'workshop'; }
      }
    } else if (pressed('Escape')) { Au.back(); state = 'workshop'; }
  }

  // ---- Draw ---------------------------------------------------------------
  function draw() {
    input.hits = [];
    switch (state) {
      case 'title': drawTitle(); break;
      case 'levels': drawLevels(); break;
      case 'intro': drawIntro(); break;
      case 'workshop': drawWorkshop(); break;
      case 'launch': drawLaunch(); break;
      case 'help': drawHelp(); break;
    }
    if (ws.msg && time - ws.msgT < 2 && state !== 'workshop') {
      R.panel(W / 2 - 60, H - 24, 120, 13, C.BLACK, C.YELLOW);
      F.drawCentered(ctx, ws.msg, W / 2, H - 21, C.YELLOW);
    }
    if (Au.isMuted()) F.draw(ctx, 'MUTE', W - 28, 2, C.LIGHTGRAY);
  }

  function button(x, y, w, label, selected, fn, color) {
    var hov = hovered(x, y, w, 13);
    R.panel(x, y, w, 13, selected || hov ? C.PUMPKIN : C.DARKBROWN, selected || hov ? C.YELLOW : C.LIGHTWOOD);
    F.drawCentered(ctx, label, x + w / 2, y + 3, color || C.WHITE);
    hit(x, y, w, 13, fn);
  }

  function drawTitle() {
    var cam = R.makeCamera();
    cam.s = 13; cam.x = 9; cam.y = 0;
    R.drawSky(cam, time);
    R.drawGround(cam, null, null);
    if (titleSim) {
      R.drawTrebuchet(titleSim, cam, titleSim.build, {});
      if (titleSim.released && !titleSim.landed) {
        var p = R.toScreen(cam, titleSim.proj.x, titleSim.proj.y);
        R.drawPumpkin(p.x, p.y, titleSim.pr * cam.s, false);
      }
    }
    // Title
    var bob = Math.round(Math.sin(time * 2) * 2);
    R.panel(W / 2 - 120, 14 + bob, 240, 52, C.BLACK, C.PUMPKIN);
    F.drawShadow(ctx, 'PUMPKIN', W / 2 - F.width('PUMPKIN', 3) / 2, 20 + bob, C.PUMPKIN, C.PUMPKINDARK, 3);
    F.drawShadow(ctx, 'CHUNKIN', W / 2 - F.width('CHUNKIN', 3) / 2, 42 + bob, C.ORANGE, C.PUMPKINDARK, 3);
    R.drawPumpkin(W / 2 - 134, 40 + bob, 9, false);
    R.drawPumpkin(W / 2 + 134, 40 + bob, 9, false);
    F.drawShadow(ctx, 'BUILD IT. TUNE IT. CHUNK IT.', W / 2 - F.width('BUILD IT. TUNE IT. CHUNK IT.') / 2, 72 + bob, C.WHITE, C.NAVY);

    var items = ['CAREER', 'FREE PLAY', 'HOW TO PLAY'];
    for (var i = 0; i < items.length; i++) {
      (function (idx) {
        var y = 96 + idx * 18;
        button(W / 2 - 50, y, 100, items[idx], menuSel === idx, function () { menuSel = idx; Au.select(); titleChoose(idx); });
        if (menuSel === idx) { F.draw(ctx, '>', W / 2 - 60, y + 3, C.YELLOW); F.draw(ctx, '<', W / 2 + 54, y + 3, C.YELLOW); }
      })(i);
    }
    if (Math.floor(time * 2) % 2 === 0) F.drawCentered(ctx, 'ARROWS + ENTER, OR CLICK', W / 2, 182, C.YELLOW);
    F.drawCentered(ctx, 'M: SOUND ON/OFF', W / 2, H - 10, C.LIGHTGRAY);
  }

  function drawStars(x, y, n, max) {
    for (var i = 0; i < (max || 3); i++) F.draw(ctx, '*', x + i * 7, y, i < n ? C.YELLOW : C.GRAY);
  }

  function drawLevels() {
    R.clear(C.NAVY);
    R.dither(0, 0, W, H, C.DEEPBLUE);
    F.drawShadow(ctx, 'SELECT A LEVEL', W / 2 - F.width('SELECT A LEVEL', 2) / 2, 8, C.PUMPKIN, C.BLACK, 2);
    var cols = 4, cw = 88, ch = 66, x0 = (W - cols * cw - (cols - 1) * 6) / 2, y0 = 30;
    PC.LEVELS.forEach(function (lv, i) {
      var cx = x0 + (i % cols) * (cw + 6), cy = y0 + Math.floor(i / cols) * (ch + 8);
      var unlocked = isUnlocked(i), sel = levelSel === i;
      R.panel(cx, cy, cw, ch, unlocked ? (sel ? C.WOOD : C.DARKBROWN) : C.BLACK, sel ? C.YELLOW : (unlocked ? C.LIGHTWOOD : C.GRAY));
      F.draw(ctx, 'LEVEL ' + (i + 1), cx + 4, cy + 4, unlocked ? C.YELLOW : C.GRAY);
      var nm = lv.name.length > 13 ? lv.name.slice(0, 13) : lv.name;
      F.draw(ctx, nm, cx + 4, cy + 13, unlocked ? C.WHITE : C.GRAY);
      if (unlocked) {
        var pk = PC.findById(PC.PUMPKINS, lv.pumpkin);
        R.drawPumpkin(cx + cw - 14, cy + 32, 3 + pk.inches / 4, false);
        F.draw(ctx, pk.name + ' ' + pk.lb + 'LB', cx + 4, cy + 25, C.TAN);
        F.draw(ctx, 'GOAL ' + lv.target + ' FT', cx + 4, cy + 34, C.TAN);
        F.draw(ctx, '$' + lv.budget + (lv.maxWeight ? ' <' + lv.maxWeight + 'LB' : ''), cx + 4, cy + 43, C.TAN);
        drawStars(cx + 4, cy + 54, levelStars(i));
        if (levelBest(i)) F.drawRight(ctx, levelBest(i) + ' FT', cx + cw - 4, cy + 54, C.GREEN);
      } else {
        F.drawCentered(ctx, 'LOCKED', cx + cw / 2, cy + 36, C.GRAY);
      }
      hit(cx, cy, cw, ch, function () { levelSel = i; if (unlocked) { Au.select(); goIntro(i); } else Au.deny(); });
    });
    F.drawCentered(ctx, 'ENTER: BUILD    ESC: BACK', W / 2, H - 12, C.LIGHTGRAY);
    hit(0, H - 16, W, 16, function () { Au.back(); goTitle(); });
  }

  function drawIntro() {
    var lv = PC.LEVELS[levelIdx], pk = PC.findById(PC.PUMPKINS, lv.pumpkin);
    var cam = R.makeCamera(); cam.s = 5; cam.x = 20; cam.y = 0;
    R.drawSky(cam, time); R.drawGround(cam, lv.target, null);
    R.panel(30, 24, W - 60, 150, C.BLACK, C.PUMPKIN);
    F.drawShadow(ctx, 'LEVEL ' + (levelIdx + 1), W / 2 - F.width('LEVEL ' + (levelIdx + 1), 2) / 2, 32, C.YELLOW, C.PUMPKINDARK, 2);
    F.drawCentered(ctx, lv.name, W / 2, 50, C.WHITE);
    R.drawPumpkin(W / 2, 80, 6 + pk.inches / 2, false);
    F.drawCentered(ctx, 'PUMPKIN: ' + pk.name + ' (' + pk.lb + ' LB, ' + pk.inches + ' IN)', W / 2, 96, C.TAN);
    F.drawCentered(ctx, 'GOAL: ' + lv.target + ' FT    BUDGET: $' + lv.budget + (lv.maxWeight ? '    MAX WEIGHT: ' + lv.maxWeight + ' LB' : ''), W / 2, 106, C.TAN);
    F.drawCentered(ctx, 'STARS: ' + lv.target + ' / ' + Math.round(lv.target * 1.2) + ' / ' + Math.round(lv.target * 1.4) + ' FT', W / 2, 116, C.YELLOW);
    var lines = F.wrap(lv.tip, 48);
    for (var i = 0; i < lines.length; i++) F.drawCentered(ctx, lines[i], W / 2, 132 + i * 9, C.LIGHTGRAY);
    button(W / 2 - 60, 180, 120, 'TO THE WORKSHOP', true, function () { Au.select(); goWorkshop(); });
    F.drawCentered(ctx, 'ESC: BACK', W / 2, 200, C.LIGHTGRAY);
  }

  function drawWorkshop() {
    var lv = currentLevel(), pk = currentPumpkin();
    var b = PC.computeBuild(build);
    R.clear(C.DARKBROWN);
    R.dither(0, 0, W, H, C.BLACK);
    // Header
    R.rect(0, 0, W, 11, C.BLACK);
    var title = lv ? 'WORKSHOP - LEVEL ' + (levelIdx + 1) + ': ' + lv.name : 'WORKSHOP - FREE PLAY';
    F.draw(ctx, title, 4, 2, C.PUMPKIN);
    F.drawRight(ctx, lv ? 'GOAL ' + lv.target + ' FT' : 'BEST ' + (save.freeBest[pk.id] || 0) + ' FT', W - 4, 2, C.YELLOW);

    // Parameter list
    var list = paramList();
    var lx = 4, ly = 15, lw = 196, rowH = 10;
    R.panel(lx, ly, lw, list.length * rowH + 6, C.WOOD, C.LIGHTWOOD, false);
    list.forEach(function (p, i) {
      var y = ly + 3 + i * rowH, sel = ws.sel === i;
      if (sel || hovered(lx, y, lw, rowH)) R.rect(lx + 1, y - 1, lw - 2, rowH, sel ? C.DARKBROWN : C.LIGHTWOOD);
      F.draw(ctx, (sel ? '>' : ' ') + p.label, lx + 3, y, sel ? C.YELLOW : C.WHITE);
      var val;
      if (p.type === 'choice') val = PC.findById(p.options, getVal(p)).name;
      else val = fmt(getVal(p), 1) + (p.unit ? ' ' + p.unit : '');
      var vx = lx + lw - 14;
      F.drawRight(ctx, val, vx, y, sel ? C.YELLOW : C.TAN);
      F.draw(ctx, '<', vx - F.width(val) - 8, y, sel ? C.YELLOW : C.LIGHTWOOD);
      F.draw(ctx, '>', vx + 3, y, sel ? C.YELLOW : C.LIGHTWOOD);
      hit(lx, y - 1, lw / 2 + 20, rowH, function () { ws.sel = i; adjust(p, -1); });
      hit(lx + lw / 2 + 20, y - 1, lw / 2 - 20, rowH, function () { ws.sel = i; adjust(p, 1); });
    });

    // Stats
    var sy = ly + list.length * rowH + 10;
    R.panel(lx, sy, lw, H - sy - 16, C.BLACK, C.LIGHTWOOD, false);
    var overBudget = lv && b.cost > lv.budget, overWeight = lv && lv.maxWeight && b.weightLb > lv.maxWeight;
    F.draw(ctx, 'COST', lx + 4, sy + 3, C.LIGHTGRAY);
    F.drawRight(ctx, '$' + b.cost + (lv ? ' / $' + lv.budget : ''), lx + lw - 4, sy + 3, overBudget ? C.RED : C.GREEN);
    F.draw(ctx, 'WEIGHT', lx + 4, sy + 12, C.LIGHTGRAY);
    F.drawRight(ctx, fmt(b.weightLb) + ' LB' + (lv && lv.maxWeight ? ' / ' + lv.maxWeight + ' LB' : ''), lx + lw - 4, sy + 12, overWeight ? C.RED : C.GREEN);
    F.draw(ctx, 'FRAME LOAD', lx + 4, sy + 21, C.LIGHTGRAY);
    F.drawRight(ctx, fmt(b.frameLoad) + ' / ' + b.frameMax + ' LB', lx + lw - 4, sy + 21, b.frameOK ? (b.frameLoad > b.frameMax * 0.8 ? C.YELLOW : C.GREEN) : C.RED);
    F.draw(ctx, 'ARM LOAD', lx + 4, sy + 30, C.LIGHTGRAY);
    F.drawRight(ctx, fmt(b.armLoad) + ' / ' + b.armMax, lx + lw - 4, sy + 30, b.armOK ? (b.armLoad > b.armMax * 0.8 ? C.YELLOW : C.GREEN) : C.RED);
    var warn = null;
    if (!b.hasPower) warn = 'NO POWER SOURCE';
    else if (!b.frameOK) warn = 'FRAME WILL COLLAPSE!';
    else if (!b.armOK) warn = 'ARM WILL SNAP!';
    else if (overBudget) warn = 'OVER BUDGET';
    else if (overWeight) warn = 'TOO HEAVY FOR THIS EVENT';
    if (warn && Math.floor(time * 3) % 2 === 0) F.drawCentered(ctx, warn, lx + lw / 2, sy + 41, C.RED);
    if (ws.msg && time - ws.msgT < 2) F.drawCentered(ctx, ws.msg, lx + lw / 2, sy + 41, C.YELLOW);

    // Footer
    R.rect(0, H - 11, W, 11, C.BLACK);
    F.draw(ctx, 'ARROWS: ADJUST   SPACE: LAUNCH   ESC: BACK', 4, H - 9, C.LIGHTGRAY);
    hit(0, H - 11, W, 11, function () { Au.back(); if (mode === 'career') goLevels(); else goTitle(); });

    // Preview
    var pxp = 206, pyp = 15, pw = W - pxp - 4, ph = H - pyp - 42;
    R.panel(pxp, pyp, pw, ph, C.SKY, C.LIGHTWOOD, false);
    ctx.save(); ctx.beginPath(); ctx.rect(pxp + 1, pyp + 1, pw - 2, ph - 2); ctx.clip();
    var sim = PC.Physics.createSim(build, pk, b);
    var cam = R.makeCamera();
    cam.groundRow = pyp + ph - 8;
    var span = sim.Ll * 1.1 + sim.Ls * 2.4 + 1;
    cam.s = Math.min((pw - 10) / span, (ph - 14) / (sim.H + sim.Ls * 1.1 + sim.cwHalf + 0.5));
    cam.x = (sim.Ll * 0.4 - sim.Ls * 1.0) - (pxp + pw / 2 - W / 2) / cam.s;
    R.rect(pxp, cam.groundRow, pw, 2, C.GREEN); R.rect(pxp, cam.groundRow + 2, pw, 8, C.BROWN);
    R.drawTrebuchet(sim, cam, b, {});
    ctx.restore();
    F.draw(ctx, 'PREVIEW', pxp + 3, pyp + 3, C.BLACK);
    // Pumpkin + machine info
    var iy = pyp + ph + 3;
    R.panel(pxp, iy, pw, H - iy - 14, C.BLACK, C.LIGHTWOOD, false);
    R.drawPumpkin(pxp + 12, iy + 12, 3 + pk.inches / 3, false);
    F.draw(ctx, pk.name + ' ' + pk.lb + ' LB', pxp + 26, iy + 4, C.PUMPKIN);
    F.draw(ctx, 'AXLE ' + fmt(b.axleHeightFt, 1) + ' FT  SLING ' + fmt(build.slingPct / 100 * build.longArm, 1) + ' FT', pxp + 26, iy + 13, C.TAN);
    var okToLaunch = !canLaunch(b, lv);
    button(pxp + pw - 60, iy + 22 - 20, 56, 'LAUNCH!', okToLaunch, function () { startLaunch(); }, okToLaunch ? C.WHITE : C.GRAY);
  }

  function drawLaunch() {
    var L = launch, sim = L.sim, cam = L.cam;
    var sh = L.shake > 0.3 ? { x: (Math.random() - 0.5) * L.shake * 2, y: (Math.random() - 0.5) * L.shake * 2 } : { x: 0, y: 0 };
    var scam = { x: cam.x + sh.x / cam.s, y: cam.y + sh.y / cam.s, s: cam.s, groundRow: cam.groundRow };
    R.drawSky(scam, time);
    R.drawGround(scam, L.level ? L.level.target : null, L.splat);

    if (L.frameFail) {
      // machine sinks into a heap
      var drop = Math.min(1, L.collapseT / 0.6);
      var ccam = { x: scam.x, y: scam.y + drop * sim.H * 0.6, s: scam.s, groundRow: scam.groundRow };
      R.drawTrebuchet(sim, ccam, L.build, { snapped: true });
      for (var i = 0; i < 12; i++) {
        var a = i * 0.52 + L.collapseT, rr = (8 + i * 3) * Math.min(1, L.collapseT * 1.5);
        var g = R.toScreen(scam, 0, 0);
        R.px(g.x + Math.cos(a) * rr * 1.6, g.y - Math.abs(Math.sin(a)) * rr * 0.6 - 1, i % 2 ? C.TAN : C.LIGHTGRAY);
      }
      if (L.collapseT > 0.3) F.drawShadow(ctx, 'FRAME COLLAPSED!', W / 2 - F.width('FRAME COLLAPSED!', 2) / 2, 40, C.RED, C.BLACK, 2);
    } else {
      // trail
      for (var k = 0; k < sim.trail.length; k += 2) {
        var tp = R.toScreen(scam, sim.trail[k].x, sim.trail[k].y);
        R.px(tp.x, tp.y, C.WHITE);
      }
      R.drawTrebuchet(sim, scam, L.build, { snapped: sim.snapped });
      if (sim.released) {
        var pp = R.toScreen(scam, sim.proj.x, sim.proj.y);
        if (!sim.landed) R.drawPumpkin(pp.x, pp.y, sim.pr * scam.s, false);
      }
      if (sim.snapped && sim.t < 3) F.drawShadow(ctx, 'ARM SNAPPED!', W / 2 - F.width('ARM SNAPPED!', 2) / 2, 40, C.RED, C.BLACK, 2);
    }

    // HUD
    var pp2 = sim.pumpkinPos();
    var dist = L.frameFail ? 0 : Math.max(0, pp2.x / FT);
    var hgt = L.frameFail ? 0 : Math.max(0, pp2.y / FT);
    R.panel(3, 3, 92, 31, C.BLACK, C.LIGHTWOOD, false);
    F.draw(ctx, 'DIST', 7, 6, C.LIGHTGRAY); F.drawRight(ctx, fmt(sim.landed ? sim.distanceFt : dist) + ' FT', 91, 6, C.YELLOW);
    F.draw(ctx, 'HEIGHT', 7, 15, C.LIGHTGRAY); F.drawRight(ctx, fmt(hgt) + ' FT', 91, 15, C.WHITE);
    F.draw(ctx, 'SPEED', 7, 24, C.LIGHTGRAY); F.drawRight(ctx, fmt(sim.projSpeed() * 3.281) + ' FT/S', 91, 24, C.WHITE);
    if (L.level) {
      R.panel(W - 95, 3, 92, 13, C.BLACK, C.LIGHTWOOD, false);
      F.draw(ctx, 'GOAL', W - 91, 6, C.LIGHTGRAY); F.drawRight(ctx, L.level.target + ' FT', W - 7, 6, C.YELLOW);
    }
    if (!L.result) F.drawCentered(ctx, L.fast ? '>> FAST FORWARD >>' : 'HOLD SPACE: FAST FORWARD   ESC: WORKSHOP', W / 2, H - 9, C.WHITE);

    if (L.result) drawResult();
  }

  function drawResult() {
    var L = launch, res = L.result, lv = L.level;
    var pw = 220, ph = lv ? 112 : 96, px = (W - pw) / 2, py = (H - ph) / 2 - 6;
    R.panel(px, py, pw, ph, C.BLACK, C.PUMPKIN);
    var head = lv ? (res.stars > 0 ? 'GOAL REACHED!' : 'NOT FAR ENOUGH') : 'FREE PLAY';
    F.drawShadow(ctx, head, W / 2 - F.width(head, 2) / 2, py + 6, res.stars > 0 || !lv ? C.YELLOW : C.RED, C.PUMPKINDARK, 2);
    F.drawCentered(ctx, fmt(res.dist) + ' FT', W / 2, py + 26, C.WHITE, 2);
    if (lv) F.drawCentered(ctx, 'GOAL ' + lv.target + ' FT', W / 2, py + 44, C.TAN);
    var detail = L.frameFail ? 'THE FRAME GAVE WAY UNDER THE LOAD' :
      (L.sim.snapped ? 'THE ARM SNAPPED MID-SWING' :
        'RELEASED AT ' + fmt(res.v) + ' FT/S, ' + fmt(res.ang) + ' DEG, APEX ' + fmt(res.apex) + ' FT');
    F.drawCentered(ctx, detail, W / 2, py + (lv ? 54 : 44), C.LIGHTGRAY);
    if (lv) {
      for (var i = 0; i < 3; i++) F.draw(ctx, '*', W / 2 - 18 + i * 13, py + 66, i < res.stars ? C.YELLOW : C.GRAY, 2);
    }
    if (res.newBest) F.drawCentered(ctx, 'NEW BEST!', W / 2, py + (lv ? 82 : 56), C.GREEN);
    var by = py + ph - 18;
    button(px + 8, by, 60, 'R: RETRY', false, function () { Au.select(); startLaunch(); });
    button(px + 80, by, 60, 'W: TUNE', false, function () { Au.back(); state = 'workshop'; });
    var nextLabel = lv ? (res.stars > 0 && levelIdx + 1 < PC.LEVELS.length ? 'N: NEXT' : 'N: LEVELS') : 'N: DONE';
    button(px + 152, by, 60, nextLabel, true, function () {
      if (lv && res.stars > 0 && levelIdx + 1 < PC.LEVELS.length) { Au.select(); goIntro(levelIdx + 1); }
      else if (lv) { Au.select(); goLevels(); }
      else { Au.back(); state = 'workshop'; }
    });
  }

  function drawHelp() {
    R.clear(C.NAVY); R.dither(0, 0, W, H, C.DEEPBLUE);
    R.panel(12, 8, W - 24, H - 16, C.BLACK, C.PUMPKIN);
    F.drawShadow(ctx, 'HOW TO PLAY', W / 2 - F.width('HOW TO PLAY', 2) / 2, 14, C.PUMPKIN, C.PUMPKINDARK, 2);
    var lines = [
      ['BUILD A TREBUCHET IN THE WORKSHOP, THEN LAUNCH A PUMPKIN', C.WHITE],
      ['PAST THE GOAL FLAG. STAY UNDER BUDGET (AND WEIGHT LIMITS).', C.WHITE],
      ['', 0],
      ['FRAME / ARM   STRONGER MATERIALS HOLD MORE LOAD BUT COST MORE.', C.TAN],
      ['              A LIGHT ARM WASTES LESS ENERGY ON ITSELF.', C.TAN],
      ['LONG / SHORT  LONG ARM = TIP SPEED. SHORT ARM = COUNTERWEIGHT DROP.', C.TAN],
      ['COUNTERWEIGHT MORE WEIGHT = MORE ENERGY. HINGED DROPS FURTHER.', C.TAN],
      ['LATEX BANDS   ELASTIC POWER. LIGHT, BUT PRICEY.', C.TAN],
      ['SLING LENGTH  LONGER SLING = LATER, FASTER WHIP. TOO LONG DRAGS.', C.TAN],
      ['RELEASE PIN   BIGGER ANGLE = EARLIER RELEASE = HIGHER ARC.', C.TAN],
      ['WHEELS        LET THE FRAME ROLL. HELPS SOME BUILDS.', C.TAN],
      ['', 0],
      ['HEAVY PUMPKINS WANT A LOW PIN ANGLE. LIGHT ONES WANT A HIGH ONE.', C.YELLOW],
      ['OVERLOAD THE FRAME OR ARM AND IT WILL BREAK ON LAUNCH.', C.RED],
      ['', 0],
      ['ARROWS: NAVIGATE/ADJUST  ENTER/SPACE: CONFIRM/LAUNCH  ESC: BACK', C.LIGHTGRAY],
      ['HOLD SPACE DURING A THROW TO FAST FORWARD.  M: MUTE', C.LIGHTGRAY]
    ];
    for (var i = 0; i < lines.length; i++) if (lines[i][0]) F.draw(ctx, lines[i][0], 20, 32 + i * 9, lines[i][1]);
    button(W / 2 - 40, H - 26, 80, 'BACK', true, function () { Au.back(); goTitle(); });
  }

  // ---- Boot ---------------------------------------------------------------
  function handleClick(bx, by) {
    for (var i = input.hits.length - 1; i >= 0; i--) {
      var h = input.hits[i];
      if (bx >= h.x && bx < h.x + h.w && by >= h.y && by < h.y + h.h) { h.fn(); return; }
    }
  }

  PC.Game = {
    start: function (canvas) {
      ctx = R.init(canvas);
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      canvas.addEventListener('mousemove', function (e) {
        var r = canvas.getBoundingClientRect();
        input.mouse.x = (e.clientX - r.left) / R.scale(); input.mouse.y = (e.clientY - r.top) / R.scale();
      });
      canvas.addEventListener('mousedown', function (e) {
        Au.unlock();
        var r = canvas.getBoundingClientRect();
        handleClick((e.clientX - r.left) / R.scale(), (e.clientY - r.top) / R.scale());
      });
      canvas.addEventListener('touchstart', function (e) {
        Au.unlock();
        var r = canvas.getBoundingClientRect(), t = e.touches[0];
        handleClick((t.clientX - r.left) / R.scale(), (t.clientY - r.top) / R.scale());
        e.preventDefault();
      }, { passive: false });
      goTitle();
      var last = performance.now();
      function frame(now) {
        var dt = Math.min(0.1, (now - last) / 1000); last = now;
        update(dt);
        draw();
        R.present();
        input.pressed.length = 0;
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }
  };
})(PC);
