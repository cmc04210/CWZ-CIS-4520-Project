/* Trebuchet simulation.

   Generalized-coordinate rigid-body model solved numerically each substep:
     q = [theta (arm angle), psi (counterweight hanger angle, hinged only),
          phi (sling angle), x (axle position, wheels only)]
   Point masses (arm segments, counterweight, frame, pouch+pumpkin) are
   functions of q. Each substep we build the mass matrix M = sum m J^T J and
   the generalized force vector from gravity, ground contact, latex bands and
   the arm stop, then solve M qdd = Q for the accelerations. Jacobians and the
   centripetal terms are obtained by finite differences, so adding a new
   degree of freedom only requires editing positions().

   After release the pumpkin flies ballistically with quadratic drag.
   Units are SI internally; inputs/outputs use ft and lb. */
var PC = (typeof window !== 'undefined') ? (window.PC = window.PC || {}) : (global.PC = global.PC || {});

(function (PC) {
  'use strict';

  var G = 9.81, RHO = 1.2;
  var FT = 0.3048, LB = 0.45359237, LBF = 4.44822;
  var THETA0 = 5 * Math.PI / 4;      // cocked: long arm points 45 deg down and back
  var THETA_STOP = -0.35;            // arm stop: tip 20 deg below horizontal in front
  var ARM_SEGMENTS = 6;

  function solveLinear(A, b) {
    var n = b.length, i, j, k;
    var M = A.map(function (row, r) { return row.concat([b[r]]); });
    for (i = 0; i < n; i++) {
      var p = i;
      for (j = i + 1; j < n; j++) if (Math.abs(M[j][i]) > Math.abs(M[p][i])) p = j;
      var tmp = M[i]; M[i] = M[p]; M[p] = tmp;
      var piv = M[i][i];
      if (Math.abs(piv) < 1e-12) piv = M[i][i] = 1e-12;
      for (j = i + 1; j < n; j++) {
        var f = M[j][i] / piv;
        if (f === 0) continue;
        for (k = i; k <= n; k++) M[j][k] -= f * M[i][k];
      }
    }
    var x = new Array(n);
    for (i = n - 1; i >= 0; i--) {
      var s = M[i][n];
      for (j = i + 1; j < n; j++) s -= M[i][j] * x[j];
      x[i] = s / M[i][i];
    }
    return x;
  }

  function createSim(cfg, pumpkin, build) {
    var Ll = cfg.longArm * FT, Ls = cfg.shortArm * FT;
    var H = build.axleHeightFt * FT;
    var armMass = build.armLb * LB;
    var cwMass = cfg.cwLb * LB;
    var hinged = build.hinged && cwMass > 0;
    var Lh = hinged ? 1.2 * Ls : 0;
    var Lsl = Math.max(0.3, cfg.slingPct / 100 * Ll);
    var relAng = cfg.release * Math.PI / 180;
    var wheels = build.wheels;
    var frameMass = (build.frameLb + (wheels ? PC.WHEELS.lb : 0)) * LB;
    var pm = pumpkin.lb * LB;
    var pr = pumpkin.inches * 0.0254 / 2;
    var pouchMass = 0.15;
    var kd = 0.5 * RHO * 0.47 * Math.PI * pr * pr;
    var cwHalf = Math.max(0.15, 0.25 * Math.cbrt(Math.max(cwMass, 1) / 100)); // box half-size, m

    var coords = ['th'];
    if (hinged) coords.push('ps');
    coords.push('ph');
    if (wheels) coords.push('x');
    var idx = {};
    coords.forEach(function (c, i) { idx[c] = i; });
    var n = coords.length;

    var sim = {
      cfg: cfg, pumpkin: pumpkin, build: build,
      t: 0, q: new Array(n), qd: new Array(n),
      released: false, landed: false, snapped: false,
      releaseT: null, releaseV: 0, releaseAngleDeg: 0,
      proj: null, trail: [], distanceFt: 0, apexFt: 0,
      peakArmLoad: 0,
      done: false, finishedAt: null,
      Ll: Ll, Ls: Ls, H: H, Lsl: Lsl, pr: pr, cwHalf: cwHalf, hinged: hinged, wheels: wheels,
      bandAnchor: null, bandK: 0, bandL0: 0, nBands: cfg.bands
    };

    function positions(q) {
      var th = q[idx.th];
      var ax = wheels ? q[idx.x] : 0;
      var ux = Math.cos(th), uy = Math.sin(th);
      var A = { x: ax, y: H };
      var T = { x: ax + Ll * ux, y: H + Ll * uy };
      var S = { x: ax - Ls * ux, y: H - Ls * uy };
      var C;
      if (hinged) {
        var ps = q[idx.ps];
        C = { x: S.x + Lh * Math.cos(ps), y: S.y + Lh * Math.sin(ps) };
      } else C = S;
      var ph = q[idx.ph];
      var P = { x: T.x + Lsl * Math.cos(ph), y: T.y + Lsl * Math.sin(ph) };
      var pts = [];
      for (var i = 0; i < ARM_SEGMENTS; i++) {
        var f = (i + 0.5) / ARM_SEGMENTS;
        pts.push({ x: S.x + (T.x - S.x) * f, y: S.y + (T.y - S.y) * f });
      }
      pts.push(C);   // ARM_SEGMENTS
      pts.push(A);   // +1
      pts.push(P);   // +2
      pts.push(S);   // +3 (massless; band attachment)
      pts.named = { A: A, S: S, T: T, C: C, P: P };
      return pts;
    }
    var I_C = ARM_SEGMENTS, I_A = ARM_SEGMENTS + 1, I_P = ARM_SEGMENTS + 2, I_S = ARM_SEGMENTS + 3;
    var NP = ARM_SEGMENTS + 4;

    function masses() {
      var m = [];
      for (var i = 0; i < ARM_SEGMENTS; i++) m.push(armMass / ARM_SEGMENTS);
      m.push(cwMass);
      m.push(wheels ? frameMass : 0);
      m.push(sim.released ? pouchMass : pouchMass + pm);
      m.push(0);
      return m;
    }

    // Initial state
    sim.q[idx.th] = THETA0;
    if (hinged) sim.q[idx.ps] = -Math.PI / 2;
    if (wheels) sim.q[idx.x] = 0;
    sim.q[idx.ph] = 0;
    for (var i = 0; i < n; i++) sim.qd[i] = 0;
    var p0 = positions(sim.q);
    var T0 = p0.named.T, S0 = p0.named.S;
    var dy = T0.y - pr;
    var dx = Math.sqrt(Math.max(0.01, Lsl * Lsl - dy * dy));
    sim.q[idx.ph] = Math.atan2(pr - T0.y, dx);

    if (cfg.bands > 0) {
      sim.bandAnchor = { x: -1.5 * Ls, y: 0.1 };
      var Lc = Math.hypot(S0.x - sim.bandAnchor.x, S0.y - sim.bandAnchor.y);
      sim.bandL0 = 0.5 * Lc;
      sim.bandK = (PC.BAND.lbf * LBF) / (Lc - sim.bandL0) * cfg.bands;
    }

    sim.points = positions(sim.q);
    sim.origin = { x: 0 };

    function groundForce(p, v, m, radius) {
      var pen = radius - p.y;
      if (pen <= 0) return null;
      var k = 20000 * Math.max(0.5, m);
      var c = 2 * Math.sqrt(k * Math.max(m, 0.1));
      var fy = k * pen - c * v.y;
      if (fy < 0) fy = 0;
      var fx = -0.25 * fy * Math.sign(v.x) * Math.min(1, Math.abs(v.x) / 0.2);
      return { x: fx, y: fy };
    }

    function substep(dt) {
      var q = sim.q, qd = sim.qd;
      var pos = positions(q);
      var m = masses();
      var e = 1e-6, k, i;

      // Jacobians J[i][k] = d pos_i / d q_k
      var J = [];
      for (i = 0; i < NP; i++) J.push([]);
      for (k = 0; k < n; k++) {
        var qp = q.slice(), qm = q.slice();
        qp[k] += e; qm[k] -= e;
        var pp = positions(qp), pmn = positions(qm);
        for (i = 0; i < NP; i++) J[i][k] = { x: (pp[i].x - pmn[i].x) / (2 * e), y: (pp[i].y - pmn[i].y) / (2 * e) };
      }
      // Velocities and zero-acceleration (centripetal) terms via second
      // difference along the velocity direction.
      var qdn = 0;
      for (k = 0; k < n; k++) qdn += qd[k] * qd[k];
      qdn = Math.sqrt(qdn);
      var ed = 1e-4 / Math.max(1, qdn);
      var q2p = q.slice(), q2m = q.slice();
      for (k = 0; k < n; k++) { q2p[k] += 2 * ed * qd[k]; q2m[k] -= 2 * ed * qd[k]; }
      var P2p = positions(q2p), P2m = positions(q2m);
      var vel = [], a0 = [];
      for (i = 0; i < NP; i++) {
        var vx = 0, vy = 0;
        for (k = 0; k < n; k++) { vx += J[i][k].x * qd[k]; vy += J[i][k].y * qd[k]; }
        vel.push({ x: vx, y: vy });
        a0.push({
          x: (P2p[i].x - 2 * pos[i].x + P2m[i].x) / (4 * ed * ed),
          y: (P2p[i].y - 2 * pos[i].y + P2m[i].y) / (4 * ed * ed)
        });
      }

      // Forces on points
      var F = [];
      for (i = 0; i < NP; i++) F.push({ x: 0, y: -m[i] * G });
      var gf;
      if (!sim.released) {
        gf = groundForce(pos[I_P], vel[I_P], m[I_P], pr);
        if (gf) { F[I_P].x += gf.x; F[I_P].y += gf.y; }
      }
      if (cwMass > 0) {
        gf = groundForce(pos[I_C], vel[I_C], m[I_C], cwHalf);
        if (gf) { F[I_C].x += gf.x; F[I_C].y += gf.y; sim.cwHitGround = true; }
      }
      if (sim.bandK > 0) {
        var ax = wheels ? q[idx.x] : 0;
        var bx = sim.bandAnchor.x + ax, by = sim.bandAnchor.y;
        var ddx = bx - pos[I_S].x, ddy = by - pos[I_S].y;
        var L = Math.hypot(ddx, ddy);
        if (L > sim.bandL0) {
          var f = sim.bandK * (L - sim.bandL0);
          F[I_S].x += f * ddx / L; F[I_S].y += f * ddy / L;
          F[I_A].x -= f * ddx / L; F[I_A].y -= f * ddy / L;
        }
      }
      if (wheels) {
        F[I_A].x -= 30 * vel[I_A].x;   // rolling resistance
      }

      // Assemble M and Q
      var Mm = [], Q = [];
      for (k = 0; k < n; k++) { Mm.push(new Array(n).fill(0)); Q.push(0); }
      for (i = 0; i < NP; i++) {
        if (m[i] === 0 && F[i].x === 0 && F[i].y === 0) continue;
        var rx = F[i].x - m[i] * a0[i].x, ry = F[i].y - m[i] * a0[i].y;
        for (k = 0; k < n; k++) {
          Q[k] += J[i][k].x * rx + J[i][k].y * ry;
          if (m[i] === 0) continue;
          for (var l = k; l < n; l++) {
            var v = m[i] * (J[i][k].x * J[i][l].x + J[i][k].y * J[i][l].y);
            Mm[k][l] += v; if (l !== k) Mm[l][k] += v;
          }
        }
      }
      // Arm stop (torsional spring + damper) once the arm has swung through
      var th = q[idx.th];
      if (th < THETA_STOP) {
        var Kst = 4000 * (armMass + cwMass + 20);
        Q[idx.th] += Kst * (THETA_STOP - th) - 0.4 * Kst * qd[idx.th];
      }
      // Small bearing friction
      Q[idx.th] -= 0.02 * (armMass + cwMass) * qd[idx.th];
      if (hinged) Q[idx.ps] -= 0.01 * cwMass * qd[idx.ps];
      for (k = 0; k < n; k++) Mm[k][k] += 1e-6;

      var acc = solveLinear(Mm, Q);
      for (k = 0; k < n; k++) { qd[k] += acc[k] * dt; q[k] += qd[k] * dt; }
      sim.points = pos;
      sim.vel = vel;

      // Track arm bending load from the counterweight side (for the "snap" check UI)
      return pos;
    }

    function checkRelease(pos) {
      var A = pos.named.A, T = pos.named.T, P = pos.named.P;
      var ax = (T.x - A.x) / Ll, ay = (T.y - A.y) / Ll;
      var sx = (P.x - T.x) / Lsl, sy = (P.y - T.y) / Lsl;
      var ang = Math.acos(Math.max(-1, Math.min(1, ax * sx + ay * sy)));
      var th = sim.q[idx.th];
      var lifted = P.y > pr + 0.05;
      var force = th < THETA_STOP + 0.05;
      if ((ang < relAng && lifted && sim.t > 0.03) || force || sim.snapAt !== undefined && sim.t >= sim.snapAt) {
        doRelease();
      }
    }

    function doRelease() {
      var P = sim.points.named.P;
      var v = sim.vel[I_P];
      sim.released = true;
      sim.releaseT = sim.t;
      sim.releaseV = Math.hypot(v.x, v.y);
      sim.releaseAngleDeg = Math.atan2(v.y, v.x) * 180 / Math.PI;
      sim.proj = { x: P.x, y: P.y, vx: v.x, vy: v.y };
      if (sim.snapAt !== undefined) sim.snapped = true;
      sim.trail.push({ x: P.x, y: P.y });
    }

    function stepProjectile(dt) {
      var p = sim.proj;
      var sp = Math.hypot(p.vx, p.vy);
      var ax = -(kd / pm) * sp * p.vx;
      var ay = -G - (kd / pm) * sp * p.vy;
      p.vx += ax * dt; p.vy += ay * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.y > sim.apexM || sim.apexM === undefined) sim.apexM = p.y;
      if (p.y <= pr && p.vy < 0 && sim.t - sim.releaseT > 0.05) {
        p.y = pr;
        sim.landed = true;
        sim.distanceFt = Math.max(0, p.x / FT);
        sim.apexFt = (sim.apexM || 0) / FT;
        sim.finishedAt = sim.t;
      }
    }

    sim.step = function (frameDt) {
      if (sim.done) return;
      var dt = 1 / 3000;
      var steps = Math.max(1, Math.round(frameDt / dt));
      var trailEvery = Math.round(0.05 / dt), tc = 0;
      for (var s = 0; s < steps; s++) {
        var pos = substep(dt);
        if (!sim.released) checkRelease(pos);
        if (sim.released && !sim.landed) {
          stepProjectile(dt);
          if (++tc >= trailEvery) { tc = 0; sim.trail.push({ x: sim.proj.x, y: sim.proj.y }); }
        }
        sim.t += dt;
        if (sim.landed && sim.t - sim.finishedAt > 1.5) { sim.done = true; break; }
        if (!sim.released && sim.t > 8) { sim.done = true; sim.landed = true; sim.distanceFt = 0; sim.finishedAt = sim.t; break; }
      }
      sim.points = positions(sim.q);
    };

    // Arm failure: snap shortly after the swing starts.
    sim.scheduleSnap = function (t) { sim.snapAt = t; };

    sim.pumpkinPos = function () {
      if (sim.released) return { x: sim.proj.x, y: sim.proj.y };
      var P = sim.points.named.P;
      return { x: P.x, y: P.y };
    };
    sim.projSpeed = function () {
      if (!sim.released) return 0;
      return Math.hypot(sim.proj.vx, sim.proj.vy);
    };

    return sim;
  }

  // Headless helper: run a build to completion, return the result summary.
  function runToEnd(cfg, pumpkin, build) {
    var sim = createSim(cfg, pumpkin, build);
    var guard = 0;
    while (!sim.done && guard++ < 20000) sim.step(1 / 60);
    return {
      distanceFt: sim.distanceFt, apexFt: sim.apexFt || 0,
      releaseV: sim.releaseV, releaseAngleDeg: sim.releaseAngleDeg,
      releaseT: sim.releaseT, t: sim.t, cwHitGround: !!sim.cwHitGround
    };
  }

  PC.Physics = { createSim: createSim, runToEnd: runToEnd, FT: FT, LB: LB, THETA0: THETA0 };
})(PC);
