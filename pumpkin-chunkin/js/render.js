/* Low-resolution pixel renderer: palette, primitives, scenery, trebuchet. */
var PC = (typeof window !== 'undefined') ? (window.PC = window.PC || {}) : (global.PC = global.PC || {});

(function (PC) {
  'use strict';

  var W = 384, H = 216;

  var PAL = [
    '#0b0b1a', '#1d2b53', '#2d4f8f', '#3a86d6', '#6fc3ff', '#b5e8ff', '#fff1e8', '#c2c3c7',
    '#5f574f', '#ab5236', '#ffa300', '#ffec27', '#008751', '#00e436', '#ff004d', '#ffccaa',
    '#7e2553', '#83769c', '#ff77a8', '#e07020', '#a04010', '#3b2a1a', '#5a3d2b', '#8a5a3a',
    '#c0c0c8', '#404048', '#2a6b2a', '#4f9a3f'
  ];
  var C = {
    BLACK: 0, NAVY: 1, DEEPBLUE: 2, BLUE: 3, SKY: 4, PALESKY: 5, WHITE: 6, LIGHTGRAY: 7,
    GRAY: 8, BROWN: 9, ORANGE: 10, YELLOW: 11, DARKGREEN: 12, GREEN: 13, RED: 14, TAN: 15,
    MAROON: 16, LAVENDER: 17, PINK: 18, PUMPKIN: 19, PUMPKINDARK: 20, DARKBROWN: 21, WOOD: 22,
    LIGHTWOOD: 23, STEEL: 24, DARKSTEEL: 25, HILL: 26, HILL2: 27
  };

  var canvas, ctx, screen, sctx, scale = 1;

  function init(screenCanvas) {
    screen = screenCanvas;
    sctx = screen.getContext('2d');
    canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    resize();
    window.addEventListener('resize', resize);
    return ctx;
  }

  function resize() {
    var ww = window.innerWidth, wh = window.innerHeight;
    scale = Math.max(1, Math.floor(Math.min(ww / W, wh / H)));
    screen.width = W * scale; screen.height = H * scale;
    screen.style.width = (W * scale) + 'px';
    screen.style.height = (H * scale) + 'px';
    sctx.imageSmoothingEnabled = false;
  }

  function present() {
    sctx.imageSmoothingEnabled = false;
    sctx.drawImage(canvas, 0, 0, W, H, 0, 0, W * scale, H * scale);
  }

  function col(i) { return PAL[i] || i; }
  function clear(c) { ctx.fillStyle = col(c); ctx.fillRect(0, 0, W, H); }
  function rect(x, y, w, h, c) { ctx.fillStyle = col(c); ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
  function px(x, y, c) { ctx.fillStyle = col(c); ctx.fillRect(Math.round(x), Math.round(y), 1, 1); }
  function frame(x, y, w, h, c) {
    rect(x, y, w, 1, c); rect(x, y + h - 1, w, 1, c); rect(x, y, 1, h, c); rect(x + w - 1, y, 1, h, c);
  }

  function line(x0, y0, x1, y1, c, thick) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    thick = thick || 1;
    var dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    var sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
    ctx.fillStyle = col(c);
    var off = Math.floor(thick / 2);
    var horizontalish = dx > -dy;
    for (var guard = 0; guard < 4000; guard++) {
      if (thick === 1) ctx.fillRect(x0, y0, 1, 1);
      else if (horizontalish) ctx.fillRect(x0, y0 - off, 1, thick);
      else ctx.fillRect(x0 - off, y0, thick, 1);
      if (x0 === x1 && y0 === y1) break;
      var e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  function circle(cx, cy, r, c, fill) {
    cx = Math.round(cx); cy = Math.round(cy); r = Math.max(0, Math.round(r));
    ctx.fillStyle = col(c);
    if (r === 0) { ctx.fillRect(cx, cy, 1, 1); return; }
    for (var y = -r; y <= r; y++) {
      var w = Math.floor(Math.sqrt(r * r - y * y + 0.5));
      if (fill) ctx.fillRect(cx - w, cy + y, 2 * w + 1, 1);
      else {
        ctx.fillRect(cx - w, cy + y, 1, 1); ctx.fillRect(cx + w, cy + y, 1, 1);
        if (y !== 0) {
          var w2 = Math.floor(Math.sqrt(r * r - (Math.abs(y) - 1) * (Math.abs(y) - 1) + 0.5));
          if (w2 > w + 1) { ctx.fillRect(cx - w2 + 1, cy + y, w2 - w - 1, 1); ctx.fillRect(cx + w + 1, cy + y, w2 - w - 1, 1); }
        }
      }
    }
  }

  function panel(x, y, w, h, fill, border, shadow) {
    if (shadow !== false) rect(x + 2, y + 2, w, h, C.BLACK);
    rect(x, y, w, h, fill);
    frame(x, y, w, h, border);
  }

  function dither(x, y, w, h, c) {
    ctx.fillStyle = col(c);
    for (var yy = Math.round(y); yy < y + h; yy++)
      for (var xx = Math.round(x) + (yy & 1); xx < x + w; xx += 2) ctx.fillRect(xx, yy, 1, 1);
  }

  // ---- Camera -----------------------------------------------------------
  // World units are metres; ground at y = 0; +x is the throw direction.
  function makeCamera() { return { x: 0, y: 0, s: 12, groundRow: H * 0.78 }; }
  function toScreen(cam, wx, wy) {
    return { x: (wx - cam.x) * cam.s + W / 2, y: cam.groundRow - (wy - cam.y) * cam.s };
  }

  // ---- Scenery ------------------------------------------------------------
  function drawSky(cam, t) {
    // Colour by world altitude so climbing into the sky darkens it.
    var bands = [[0, C.PALESKY], [12, C.SKY], [45, C.BLUE], [110, C.DEEPBLUE], [220, C.NAVY], [400, C.BLACK]];
    var groundScreen = toScreen(cam, 0, 0).y;
    for (var row = 0; row < H; row++) {
      var alt = cam.y + (cam.groundRow - row) / cam.s;
      var c = bands[0][1];
      for (var i = 0; i < bands.length; i++) if (alt >= bands[i][0]) c = bands[i][1];
      // dither transitions
      var next = null;
      for (var j = 0; j < bands.length - 1; j++) if (alt >= bands[j][0] && alt < bands[j + 1][0]) next = bands[j + 1];
      if (next) {
        var span = next[0] - bands[j][0], into = (alt - (next[0] - span * 0.3)) / (span * 0.3);
        if (into > 0.66 && (row & 1) === 0) c = next[1];
        else if (into > 0.33 && (row & 3) === 0) c = next[1];
        else if (into > 0 && (row & 7) === 0) c = next[1];
      }
      rect(0, row, W, 1, c);
    }
    // Sun
    var sun = toScreen(cam, cam.x + 90, 70);
    sun.x = W - 40 - (cam.x * 0.02) % 10; sun.y = Math.max(12, Math.min(H, 30 + cam.y * cam.s * 0.15));
    if (groundScreen > 0) { circle(sun.x, sun.y, 7, C.YELLOW, true); circle(sun.x, sun.y, 5, C.WHITE, true); }
    // Clouds (parallax 0.15)
    var seed = 7;
    for (var k = 0; k < 9; k++) {
      seed = (seed * 9301 + 49297) % 233280;
      var cx = ((k * 173 + seed % 97) - cam.x * cam.s * 0.15 + t * 2) % (W + 120) - 60;
      if (cx < -60) cx += W + 120;
      var cy = 20 + (k * 37) % 70 + cam.y * cam.s * 0.1;
      if (cy > groundScreen - 20) continue;
      rect(cx, cy, 22, 5, C.WHITE); rect(cx + 5, cy - 3, 11, 3, C.WHITE); rect(cx + 3, cy + 5, 16, 2, C.LIGHTGRAY);
    }
    // Hills (parallax 0.35)
    if (groundScreen > -40 && groundScreen < H + 40) {
      var hy = groundScreen;
      for (var hx = -60; hx < W + 60; hx += 3) {
        var wx = hx + cam.x * cam.s * 0.35;
        var hgt = 12 + 9 * Math.sin(wx * 0.021) + 6 * Math.sin(wx * 0.047 + 1.3) + 3 * Math.sin(wx * 0.11);
        rect(hx, hy - hgt, 3, hgt + 2, C.HILL);
        rect(hx, hy - hgt, 3, 1, C.HILL2);
      }
    }
  }

  function drawGround(cam, targetFt, splat) {
    var g = toScreen(cam, 0, 0).y;
    if (g < H) {
      rect(0, g, W, 2, C.GREEN);
      rect(0, g + 2, W, Math.max(0, H - g - 2), C.BROWN);
      if (g + 2 < H) dither(0, g + 2, W, Math.min(6, H - g - 2), C.DARKBROWN);
      // grass tufts
      for (var x = -((cam.x * cam.s) % 14); x < W; x += 14) px(x + 3, g - 1, C.GREEN);
    }
    // distance markers every 50 ft
    var FT = PC.Physics.FT;
    var stepFt = cam.s < 3 ? 100 : 50;
    var first = Math.floor(((cam.x - W / 2 / cam.s) / FT) / stepFt) * stepFt;
    for (var ft = Math.max(stepFt, first); ft * FT < cam.x + W / 2 / cam.s + 5; ft += stepFt) {
      var p = toScreen(cam, ft * FT, 0);
      var ph = ft % 100 === 0 ? 14 : 9;
      rect(p.x, p.y - ph, 1, ph, C.WHITE);
      rect(p.x + 1, p.y - ph, 5, 3, ft % 100 === 0 ? C.RED : C.YELLOW);
      if (ft % 100 === 0 || cam.s > 6) PC.Font.drawCentered(ctx, String(ft), p.x, p.y - ph - 9, C.WHITE);
    }
    if (targetFt) {
      var tp = toScreen(cam, targetFt * FT, 0);
      rect(tp.x, tp.y - 22, 1, 22, C.WHITE);
      for (var yy = 0; yy < 3; yy++) for (var xx = 0; xx < 4; xx++) px(tp.x + 1 + xx * 2, tp.y - 22 + yy * 2, (xx + yy) & 1 ? C.WHITE : C.BLACK);
      rect(tp.x + 1, tp.y - 22, 8, 6, 'rgba(0,0,0,0)');
      for (var yy2 = 0; yy2 < 6; yy2++) for (var xx2 = 0; xx2 < 8; xx2++) px(tp.x + 1 + xx2, tp.y - 22 + yy2, ((xx2 >> 1) + (yy2 >> 1)) & 1 ? C.WHITE : C.BLACK);
      PC.Font.drawCentered(ctx, 'TARGET', tp.x + 4, tp.y - 32, C.YELLOW);
    }
    if (splat) {
      var sp = toScreen(cam, splat.x, 0);
      var r = Math.max(2, splat.r * cam.s);
      rect(sp.x - r, sp.y - 1, 2 * r, 2, C.PUMPKIN);
      rect(sp.x - r * 0.6, sp.y - 2, r * 1.2, 1, C.PUMPKIN);
      for (var i = 0; i < 6; i++) px(sp.x + Math.round(Math.cos(i * 1.1) * r * 1.4), sp.y - 1 - (i % 3), C.PUMPKIN);
    }
  }

  // ---- Pumpkin ------------------------------------------------------------
  function drawPumpkin(sx, sy, r, flat) {
    sx = Math.round(sx); sy = Math.round(sy); r = Math.max(1.5, r);
    if (r < 2.5) {
      rect(sx - 1, sy - 1, 3, 2, C.PUMPKIN); px(sx, sy - 2, C.DARKGREEN); return;
    }
    var rr = Math.round(r);
    circle(sx, sy, rr, C.PUMPKINDARK, true);
    circle(sx, sy, Math.max(1, rr - 1), C.PUMPKIN, true);
    // ribs
    var rib = Math.max(1, Math.round(rr * 0.45));
    rect(sx - rib, sy - rr + 2, 1, 2 * rr - 3, C.PUMPKINDARK);
    rect(sx + rib, sy - rr + 2, 1, 2 * rr - 3, C.PUMPKINDARK);
    if (rr > 5) { rect(sx, sy - rr + 1, 1, 2 * rr - 1, C.PUMPKINDARK); px(sx - rib + 1, sy - rr + 3, C.ORANGE); px(sx - rib + 1, sy - rr + 4, C.ORANGE); }
    // stem
    rect(sx - (flat ? 0 : 1), sy - rr - Math.max(1, Math.round(rr * 0.3)), Math.max(1, Math.round(rr * 0.25)), Math.max(1, Math.round(rr * 0.3)) + 1, C.DARKGREEN);
    if (rr > 4) px(sx + 1, sy - rr - 1, C.GREEN);
  }

  // ---- Trebuchet ----------------------------------------------------------
  function drawTrebuchet(sim, cam, build, opts) {
    opts = opts || {};
    var pts = sim.points.named;
    var A = toScreen(cam, pts.A.x, pts.A.y), S = toScreen(cam, pts.S.x, pts.S.y), T = toScreen(cam, pts.T.x, pts.T.y);
    var Cc = toScreen(cam, pts.C.x, pts.C.y), P = toScreen(cam, pts.P.x, pts.P.y);
    var s = cam.s;
    var fr = build.frame, ar = build.arm;
    var ax = pts.A.x; // frame x (moves with wheels)
    var g = toScreen(cam, 0, 0).y;
    var baseHalf = 0.45 * sim.Ll + 0.5 * sim.Ls + 0.4;
    var bl = toScreen(cam, ax - baseHalf, 0), br = toScreen(cam, ax + baseHalf * 0.75, 0);
    var baseY = sim.wheels ? g - Math.max(2, 0.3 * s) : g;
    var pw = Math.max(1, Math.round(s * 0.09));

    // Trough
    var tl = toScreen(cam, ax - 0.8 * sim.Ll, 0), tr = toScreen(cam, ax + 0.45 * sim.Ll, 0);
    rect(tl.x, baseY - pw - 1, tr.x - tl.x, 1, C.DARKBROWN);

    // Wheels
    if (sim.wheels) {
      var wr = Math.max(2, 0.3 * s);
      circle(bl.x + wr, g - wr, wr, C.DARKSTEEL, true); circle(bl.x + wr, g - wr, Math.max(1, wr - 2), C.GRAY, true);
      circle(br.x - wr, g - wr, wr, C.DARKSTEEL, true); circle(br.x - wr, g - wr, Math.max(1, wr - 2), C.GRAY, true);
    }
    // Base rails
    rect(bl.x, baseY - pw, br.x - bl.x, pw, fr.color);
    rect(bl.x, baseY - 1, br.x - bl.x, 1, fr.dark);
    // A-frame
    var spread = 0.32 * sim.H;
    var f1 = toScreen(cam, ax - spread, 0), f2 = toScreen(cam, ax + spread, 0);
    line(f1.x, baseY, A.x, A.y, fr.color, pw); line(f2.x, baseY, A.x, A.y, fr.color, pw);
    line(f1.x + (A.x - f1.x) * 0.5, baseY - (baseY - A.y) * 0.5, f2.x + (A.x - f2.x) * 0.5, baseY - (baseY - A.y) * 0.5, fr.dark, 1);
    // Band anchor + bands
    if (sim.nBands > 0 && sim.bandAnchor) {
      var an = toScreen(cam, ax + sim.bandAnchor.x, sim.bandAnchor.y);
      rect(an.x - 1, an.y - 1, 3, 3, C.DARKSTEEL);
      var bt = sim.nBands > 8 ? 3 : (sim.nBands > 3 ? 2 : 1);
      line(S.x, S.y, an.x, an.y, C.RED, bt);
      if (sim.nBands > 1) line(S.x + 1, S.y, an.x + 1, an.y, C.MAROON, 1);
    }
    // Arm (thicker near the pivot)
    var at = Math.max(1, Math.round(s * 0.08));
    line(S.x, S.y, T.x, T.y, ar.color, at);
    if (at > 1) line(S.x, S.y, A.x + (T.x - A.x) * 0.5, A.y + (T.y - A.y) * 0.5, ar.dark, 1);
    if (opts.snapped) {
      // crack mark near the pivot
      var mx = A.x + (T.x - A.x) * 0.3, my = A.y + (T.y - A.y) * 0.3;
      line(mx - 2, my - 3, mx + 2, my + 3, C.BLACK, 1);
    }
    // Hanger + counterweight
    if (sim.cfg.cwLb > 0) {
      if (sim.hinged) line(S.x, S.y, Cc.x, Cc.y, C.DARKSTEEL, 1);
      var half = Math.max(2, sim.cwHalf * s);
      rect(Cc.x - half, Cc.y - half, 2 * half, 2 * half, C.GRAY);
      frame(Cc.x - half, Cc.y - half, 2 * half, 2 * half, C.DARKSTEEL);
      if (half > 4) { rect(Cc.x - half + 2, Cc.y - 1, 2 * half - 4, 1, C.DARKSTEEL); }
    }
    // Axle
    circle(A.x, A.y, Math.max(1, Math.round(s * 0.06)), C.DARKSTEEL, true);
    // Sling + pouch + pumpkin
    if (!sim.released) {
      line(T.x, T.y, P.x, P.y, C.WHITE, 1);
      drawPumpkin(P.x, P.y, sim.pr * s, false);
    } else {
      // loose sling trails from the tip
      var dx = -Math.cos(sim.q[0]) * sim.Lsl * 0.6, dy = -Math.abs(Math.sin(sim.q[0])) * sim.Lsl * 0.5;
      var e = toScreen(cam, pts.T.x + dx, Math.max(0.05, pts.T.y + dy));
      line(T.x, T.y, e.x, e.y, C.WHITE, 1);
    }
  }

  PC.Render = {
    W: W, H: H, PAL: PAL, C: C,
    init: init, present: present, ctx: function () { return ctx; },
    clear: clear, rect: rect, px: px, frame: frame, line: line, circle: circle, panel: panel, dither: dither,
    makeCamera: makeCamera, toScreen: toScreen,
    drawSky: drawSky, drawGround: drawGround, drawPumpkin: drawPumpkin, drawTrebuchet: drawTrebuchet,
    scale: function () { return scale; }
  };
})(PC);
