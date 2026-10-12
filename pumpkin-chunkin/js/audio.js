/* Tiny chiptune synth on Web Audio: square/triangle beeps and noise bursts. */
var PC = (typeof window !== 'undefined') ? (window.PC = window.PC || {}) : (global.PC = global.PC || {});

(function (PC) {
  'use strict';

  var ctx = null, master = null, muted = false, noiseBuf = null;

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.18;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  function tone(freq, dur, type, vol, slideTo, when) {
    if (muted || !ensure()) return;
    var t = ctx.currentTime + (when || 0);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(vol || 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(dur, vol, lowpass, when) {
    if (muted || !ensure()) return;
    var t = ctx.currentTime + (when || 0);
    var s = ctx.createBufferSource(); s.buffer = noiseBuf;
    var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass || 1200;
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + dur + 0.02);
  }

  PC.Audio = {
    unlock: ensure,
    toggleMute: function () { muted = !muted; return muted; },
    isMuted: function () { return muted; },
    tick: function () { tone(880, 0.04, 'square', 0.25); },
    move: function () { tone(440, 0.05, 'square', 0.25); },
    back: function () { tone(330, 0.08, 'square', 0.3, 220); },
    select: function () { tone(660, 0.06, 'square', 0.35); tone(990, 0.08, 'square', 0.35, null, 0.06); },
    deny: function () { tone(150, 0.15, 'sawtooth', 0.4, 90); },
    launch: function () { noise(0.5, 0.5, 900); tone(200, 0.4, 'triangle', 0.5, 60); },
    release: function () { noise(0.35, 0.45, 3000); tone(500, 0.3, 'square', 0.25, 1600); },
    splat: function () { noise(0.3, 0.7, 500); tone(120, 0.25, 'triangle', 0.6, 40); },
    crack: function () { noise(0.2, 0.8, 2500); tone(90, 0.3, 'sawtooth', 0.5, 40); },
    fanfare: function (stars) {
      var seq = [523, 659, 784, 1047];
      for (var i = 0; i < seq.length; i++) tone(seq[i], 0.14, 'square', 0.35, null, i * 0.11);
      for (var s = 0; s < stars; s++) tone(1319, 0.12, 'square', 0.3, null, 0.6 + s * 0.15);
    },
    sad: function () { tone(392, 0.2, 'square', 0.3); tone(330, 0.2, 'square', 0.3, null, 0.2); tone(262, 0.4, 'square', 0.3, null, 0.4); }
  };
})(PC);
