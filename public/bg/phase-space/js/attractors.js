'use strict';
// Phase Space, a Wallpaper Engine web wallpaper. Three modes share one dust and one glow:
//   Discovery - new chaotic flows, found as it runs (below); Classic - the five textbook systems. Both are particles:
//               ~260k particles advected on the GPU through a 3D chaotic flow (Halvorsen, Aizawa, Thomas, Dadras, Lorenz),
//               each mapped into one unit space, so a morph is a blend of two vector fields and the cloud flows from one
//               attractor into the next. Each particle is drawn as K points along its frame step (a streak, not a jump).
//   Smoke     - a 2D sculpture: a 6-parameter Clifford / de Jong map iterated on the GPU and splatted into a float
//               buffer that decays like smoke; its parameters walk along a path checked on the CPU to stay chaotic.
//   Dust      - ~100k grains on a slow ABC (curl) flow, out of focus into bokeh; in the particle modes a third of them, on their
//               own slow cycle, fly to the attractor, ride its flow, and are flung back out.
//   Glow      - a slow time average of the light, lifted so its faint tail reaches across the screen.
// Capture mode (?shots=) and the live test (?livetest=) are development aids that Wallpaper Engine never sets.
(() => {
const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) && isFinite(+q.get(k)) ? +q.get(k) : d);
const SHOTS = q.has('shots') ? q.get('shots').split(',').map(Number) : null, still = !!SHOTS;
const LIVETEST = !still && q.has('livetest');
if (still || LIVETEST) addEventListener('error', (e) => { document.title = 'error ' + e.message; });
const FPS = 30;
const cv = document.getElementById('field'), hudEl = document.getElementById('hud');
const gl = cv.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: false });
if (!gl) { document.title = 'error no webgl2'; return; }
const CBF = !!gl.getExtension('EXT_color_buffer_float'), FBLEND = !!gl.getExtension('EXT_float_blend');
const FLIN = !!gl.getExtension('OES_texture_float_linear');
const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');

// ---- rng: one stream per mode, so starting one never shifts the other's ----
function mkRng(s) {
  return () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const SEED = num('seed', still ? 7 : (Date.now() & 0xffffff));
const rnd = mkRng(SEED), rnd2 = mkRng(SEED ^ 0x5bd1e995);
// the first sculpture is random: Discovery and Classic open on one of the five textbook systems, from its own stream, so the
// particles' and Smoke's numbers do not move. Live the seed is the time at load; ?seed= makes it repeatable. Capture mode
// opens on Halvorsen unless ?randomstart=1, so its frames stay what they were at a fixed seed. Classic's order is drawn from
// a stream of its own (rnd6).
const rnd4 = mkRng(SEED ^ 0x68e31da4), RANDOM_START = !still || q.has('randomstart'), rnd6 = mkRng(SEED ^ 0x2c1b3c6d);
const lerp = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const sstep = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const smooth5 = (t) => t * t * t * (t * (6 * t - 15) + 10);

// ---- settings (Wallpaper Engine properties; project.json holds the same defaults) ----
// Themes: three colours (slow, middle, fast in the particle modes; around the circle of jump directions in Smoke), the sky's two
// greys, and the dust's tint. Coral & ice is the default; the other four came first.
const THEMES = {
  coral: { name: 'Coral & ice', c: [[1.0, 0.36, 0.26], [1.0, 0.78, 0.86], [0.42, 0.68, 1.0]], bg: [[0.035, 0.04, 0.06], [0.012, 0.014, 0.024]], dust: [0.55, 0.66, 0.9] },
  aurora: { name: 'Aurora', c: [[0.16, 0.48, 1.0], [0.25, 0.95, 0.78], [0.92, 0.36, 0.86]], bg: [[0.018, 0.022, 0.04], [0.004, 0.005, 0.01]], dust: [0.5, 0.72, 0.85] },
  ember: { name: 'Ember', c: [[1.0, 0.42, 0.14], [1.0, 0.82, 0.5], [0.62, 0.16, 0.42]], bg: [[0.03, 0.018, 0.016], [0.006, 0.004, 0.004]], dust: [0.85, 0.66, 0.5] },
  glacier: { name: 'Glacier', c: [[0.32, 0.6, 1.0], [0.88, 0.95, 1.0], [0.42, 0.32, 0.95]], bg: [[0.014, 0.022, 0.036], [0.003, 0.005, 0.01]], dust: [0.6, 0.7, 0.92] },
  orchid: { name: 'Orchid', c: [[0.72, 0.38, 1.0], [1.0, 0.62, 0.55], [0.3, 0.7, 0.95]], bg: [[0.024, 0.016, 0.034], [0.005, 0.004, 0.008]], dust: [0.72, 0.62, 0.88] },
};
const THEME_ORDER = ['coral', 'aurora', 'ember', 'glacier', 'orchid'];
const QUALITY = { high: { nc: 512, nd: 192, sh: 512 }, medium: { nc: 256, nd: 128, sh: 256 }, low: { nc: 128, nd: 64, sh: 128 } };
const set = { mode: 'discovery', theme: 'ember', dust: 50, glow: 55, hold: 35, quality: 'low' };

// ---- GL helpers ----
function sh(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
function prog(vs, fs) { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, a.name); }
  return { p, u }; }
function tex(w, h, ifmt, filter, levels) {
  const tx = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tx); gl.texStorage2D(gl.TEXTURE_2D, levels || 1, ifmt, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, levels > 1 ? gl.LINEAR_MIPMAP_LINEAR : filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tx; }
function fbo(...txs) { const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  txs.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
  gl.drawBuffers(txs.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('fbo incomplete');
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); return fb; }
// a render target: one texture and its framebuffer; free() gives both back (a mode or quality change reallocates)
const rt = (w, h, ifmt, filter, levels) => { const t = tex(w, h, ifmt || gl.RGBA16F, filter || gl.LINEAR, levels); return { t, fb: fbo(t), w, h }; };
const free = (...rs) => rs.forEach((r) => { if (r) { gl.deleteTexture(r.t); gl.deleteFramebuffer(r.fb); } });
const FSV = `#version 300 es
void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2. - 1., 0., 1.); }`;
const vao0 = gl.createVertexArray();
function setU(P, uni) { for (const k in uni) { const v = uni[k], l = P.u[k]; if (l === undefined) continue;
  if (typeof v === 'number') gl.uniform1f(l, v); else if (v.length === 2) gl.uniform2fv(l, v); else if (v.length === 3) gl.uniform3fv(l, v);
  else if (v.length === 4) gl.uniform4fv(l, v); else if (v.length === 6 || v.length === 30) gl.uniform1fv(l, v); else if (v.length === 9) gl.uniformMatrix3fv(l, false, v);
  else gl.uniformMatrix4fv(l, false, v); } }
function draw(P, out, texs, uni) {
  gl.useProgram(P.p); gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.fb : null); gl.viewport(0, 0, out ? out.w : W, out ? out.h : H);
  let unit = 0; for (const k in texs) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texs[k].t || texs[k]); gl.uniform1i(P.u[k], unit++); }
  setU(P, uni); gl.bindVertexArray(vao0); gl.drawArrays(gl.TRIANGLES, 0, 3);
}
const fadeProg = prog(FSV, `#version 300 es
precision highp float; out vec4 o; void main(){ o = vec4(0.); }`);
function fade(target, k) {   // multiply a target by k (the decay of a trail or a smoke buffer)
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb); gl.viewport(0, 0, target.w, target.h); gl.enable(gl.BLEND);
  gl.useProgram(fadeProg.p); gl.blendColor(k, k, k, k); gl.blendFunc(gl.ZERO, gl.CONSTANT_COLOR); gl.bindVertexArray(vao0); gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.blendFunc(gl.ONE, gl.ONE);
}

// ======================================================================================================================
// The 3D systems (JS and GLSL share the constants)
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const SYS = [
  { name: 'Halvorsen', P0: [1.4], f: (x, y, z) => [-1.4 * x - 4 * y - 4 * z - y * y, -1.4 * y - 4 * z - 4 * x - z * z, -1.4 * z - 4 * x - 4 * y - x * x], p0: [1, 0, 0], dt: 0.004, axis: [1, 1, 1] },
  { name: 'Aizawa', P0: [0.95, 0.7, 0.6, 3.5, 0.25, 0.1], f: (x, y, z) => [(z - 0.7) * x - 3.5 * y, 3.5 * x + (z - 0.7) * y, 0.6 + 0.95 * z - z * z * z / 3 - (x * x + y * y) * (1 + 0.25 * z) + 0.1 * z * x * x * x], p0: [0.1, 0, 0], dt: 0.005, axis: [0, 0, 1] },
  { name: 'Thomas', P0: [0.208186], f: (x, y, z) => [Math.sin(y) - 0.208186 * x, Math.sin(z) - 0.208186 * y, Math.sin(x) - 0.208186 * z], p0: [1, 0.5, 0], dt: 0.03, axis: [1, 1, 1] },
  // a small body with long thin arms (median radius 0.31 of its 97th percentile, the others 0.49-0.76): drawn 1.35x, its
  // farthest point still inside the rebirth bound 2.6
  { name: 'Dadras', P0: [3, 2.7, 1.7, 2, 9], f: (x, y, z) => [y - 3 * x + 2.7 * y * z, 1.7 * y - x * z + z, 2 * x * y - 9 * z], p0: [1, 1, 1], dt: 0.003, axis: [0, 0, 1], zoom: 1.35 },
  // up = the normal of the wings' plane, so the camera sees the butterfly, not its edge
  { name: 'Lorenz', P0: [10, 28, 8 / 3], f: (x, y, z) => [10 * (y - x), x * (28 - z) - y, x * y - 8 / 3 * z], p0: [1, 1, 1], dt: 0.003, axis: [1, -1, 0] },
];
// The textbook systems keep their constants in the shader (ids 0-4): with the constants as uniforms the compiler rounds
// Aizawa differently (1/255 on 375-529 pixels mid-morph), and the default stays the same, bit for bit. Id 5 is a general
// quadratic flow (the endless shapes), its 30 coefficients for the terms 1, x, y, z, x², y², z², xy, xz, yz of each equation.
const FIELD_GLSL = `
vec3 F(int id, vec3 p, float P[30]){ float x = p.x, y = p.y, z = p.z;
  if (id == 0) return vec3(-1.4*x - 4.*y - 4.*z - y*y, -1.4*y - 4.*z - 4.*x - z*z, -1.4*z - 4.*x - 4.*y - x*x);
  if (id == 1) return vec3((z - .7)*x - 3.5*y, 3.5*x + (z - .7)*y, .6 + .95*z - z*z*z/3. - (x*x + y*y)*(1. + .25*z) + .1*z*x*x*x);
  if (id == 2) return vec3(sin(y) - .208186*x, sin(z) - .208186*y, sin(x) - .208186*z);
  if (id == 3) return vec3(y - 3.*x + 2.7*y*z, 1.7*y - x*z + z, 2.*x*y - 9.*z);
  if (id == 4) return vec3(10.*(y - x), x*(28. - z) - y, x*y - 8./3.*z);
  float t[10] = float[10](1., x, y, z, x*x, y*y, z*z, x*y, x*z, y*z); vec3 o = vec3(0.);
  for (int k = 0; k < 10; k++) o += t[k] * vec3(P[k], P[10 + k], P[20 + k]);
  return o; }
// unit space: u = M (p - c) / s; du/dt = k M F(p) / s
uniform int idA, idB; uniform vec3 cA, cB; uniform vec2 skA, skB; uniform mat3 MA, MB; uniform float wB, PA[30], PB[30];
vec3 G1(int id, vec3 c, vec2 sk, mat3 M, float P[30], vec3 u){ vec3 p = c + sk.x * (transpose(M) * u); return sk.y * (M * F(id, p, P)) / sk.x; }
vec3 G(vec3 u){ vec3 a = G1(idA, cA, skA, MA, PA, u); if (wB <= 0.) return a; vec3 b = G1(idB, cB, skB, MB, PB, u); return mix(a, b, wB); }`;
const pad30 = (P) => { const o = new Float32Array(30); o.set(P); return o; };
const TARGET = 0.42;   // unit-space mean speed, units/s
function calibrate(S) {   // centre, scale and speed from an RK4 orbit; 4096 points on the attractor for rebirth
  let p = S.p0.slice(); const f = S.f, h = S.dt;
  const rk = () => { const k1 = f(...p), k2 = f(...p.map((v, j) => v + h / 2 * k1[j])), k3 = f(...p.map((v, j) => v + h / 2 * k2[j])), k4 = f(...p.map((v, j) => v + h * k3[j]));
    p = p.map((v, j) => v + h / 6 * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j])); };
  for (let i = 0; i < 8000; i++) rk();
  const pts = []; for (let i = 0; i < 60000; i++) { rk(); if (i % 12 === 0) pts.push(p.slice()); }
  const c = [0, 1, 2].map((j) => pts.reduce((a, qq) => a + qq[j], 0) / pts.length);
  const ey = norm(S.axis), ex = norm(cross(ey, Math.abs(ey[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])), ez = cross(ex, ey);
  const r = pts.map((qq) => Math.hypot(qq[0] - c[0], qq[1] - c[1], qq[2] - c[2])).sort((a, b) => a - b), s = r[Math.floor(r.length * 0.97)] / (S.zoom || 1);
  let sp = 0; for (const qq of pts) { const v = f(...qq); sp += Math.hypot(...v) / s; } sp /= pts.length;
  S.c = c; S.s = s; S.k = TARGET / sp;
  S.M = [ex[0], ey[0], ez[0], ex[1], ey[1], ez[1], ex[2], ey[2], ez[2]];   // column-major: rows ex, ey, ez
  S.ex = ex; S.ey = ey; S.ez = ez;
  const data = new Float32Array(64 * 64 * 4);
  for (let i = 0; i < 4096; i++) { const qq = pts[Math.floor(rnd() * pts.length)], d = [qq[0] - c[0], qq[1] - c[1], qq[2] - c[2]];
    data.set([dot(ex, d) / s, dot(ey, d) / s, dot(ez, d) / s, 1], i * 4); }
  S.seeds = tex(64, 64, gl.RGBA32F, gl.NEAREST); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 64, gl.RGBA, gl.FLOAT, data); S.seedData = data;
}
SYS.forEach((S, i) => { S.fam = i; S.gid = i; S.P = S.P0; S.P30 = pad30(S.P0); S.textbook = true; calibrate(S); });

// ======================================================================================================================
// Endless sculptures (Discovery): a new shape each hold rather than a loop of shapes, each staying a while before it
// changes. Discovery opens on a textbook system and then shows a new quadratic flow each hold, found by
// mutating a library of known chaotic flows. The search for the next shape runs during the hold, a fixed amount of work a
// frame (BUDGET); a candidate is shown only once it passes every check in vet(); if none has by the hold's end, the hold
// lasts. A shape is a textbook system (SYS) or an object of the same form (fam 5, P, f, c, s, k, M, seeds), made by makeShape.
const rnd5 = mkRng(SEED ^ 0x1f123bb5);   // the search's own stream: it never moves the particles' or Smoke's numbers
// a flow as f(x, y, z), a new array each call; f.z the same values written into one array it keeps and returns (the
// search's inner loops read it at once: without it they made ~150 000 arrays a frame, and the page's garbage collector
// held single search steps for 20-80 ms, measured live)
const zf = (w) => { const o = [0, 0, 0], f = (x, y, z) => { const r = [0, 0, 0]; w(x, y, z, r); return r; }; f.z = (x, y, z) => { w(x, y, z, o); return o; }; return f; };
// a general quadratic flow: per equation the coefficients of 1, x, y, z, x², y², z², xy, xz, yz (the shader's id 5)
const quadF = (Q) => zf((x, y, z, o) => { const a = x * x, b = y * y, c = z * z, d = x * y, e = x * z, g = y * z;
  o[0] = Q[0] + Q[1] * x + Q[2] * y + Q[3] * z + Q[4] * a + Q[5] * b + Q[6] * c + Q[7] * d + Q[8] * e + Q[9] * g;
  o[1] = Q[10] + Q[11] * x + Q[12] * y + Q[13] * z + Q[14] * a + Q[15] * b + Q[16] * c + Q[17] * d + Q[18] * e + Q[19] * g;
  o[2] = Q[20] + Q[21] * x + Q[22] * y + Q[23] * z + Q[24] * a + Q[25] * b + Q[26] * c + Q[27] * d + Q[28] * e + Q[29] * g; });
// The search's library: 12 known chaotic quadratic flows (Lorenz, Rössler, Dadras, Chen, Lü, Rucklidge, and Sprott's B, C,
// D, G, H, I from "Some simple chaotic flows", Phys. Rev. E 50, 1994). A candidate mutates one of these, or the discovery
// on screen, or is drawn at random (Sprott's own search: every coefficient in ±1.2 at 0.1). Measured (80 mutations
// each): these pass 11-70% of the time; Halvorsen, Sprott A, E, F, J-S passed under 10% and are left
// out. Fully random flows pass about 1 in 4000 draws (300 000 draws).
const QT = { 1: 0, x: 1, y: 2, z: 3, xx: 4, yy: 5, zz: 6, xy: 7, xz: 8, yz: 9 };
const qlib = (name, ...eqs) => { const Q = new Array(30).fill(0); eqs.forEach((eq, e) => { for (const k in eq) Q[e * 10 + QT[k]] = eq[k]; }); return { name, Q }; };
const QLIB = [
  qlib('Lorenz', { x: -10, y: 10 }, { x: 28, y: -1, xz: -1 }, { xy: 1, z: -8 / 3 }),
  qlib('Rössler', { y: -1, z: -1 }, { x: 1, y: 0.2 }, { 1: 0.2, xz: 1, z: -5.7 }),
  qlib('Dadras', { y: 1, x: -3, yz: 2.7 }, { y: 1.7, xz: -1, z: 1 }, { xy: 2, z: -9 }),
  qlib('Chen', { x: -35, y: 35 }, { x: -7, xz: -1, y: 28 }, { xy: 1, z: -3 }),
  qlib('Lü', { x: -36, y: 36 }, { xz: -1, y: 20 }, { xy: 1, z: -3 }),
  qlib('Rucklidge', { x: -2, y: 6.7, yz: -1 }, { x: 1 }, { z: -1, yy: 1 }),
  qlib('Sprott B', { yz: 1 }, { x: 1, y: -1 }, { 1: 1, xy: -1 }),
  qlib('Sprott C', { yz: 1 }, { x: 1, y: -1 }, { 1: 1, xx: -1 }),
  qlib('Sprott D', { y: -1 }, { x: 1, z: 1 }, { xz: 1, yy: 3 }),
  qlib('Sprott G', { x: 0.4, z: 1 }, { xz: 1, y: -1 }, { x: -1, y: 1 }),
  qlib('Sprott H', { y: -1, zz: 1 }, { x: 1, y: 0.5 }, { x: 1, z: -1 }),
  qlib('Sprott I', { y: -0.2 }, { x: 1, z: 1 }, { x: 1, yy: 1, z: -1 }),
];
const gauss = (r) => { let s = 0; for (let i = 0; i < 6; i++) s += r(); return (s - 3) / Math.sqrt(0.5); };
// one RK4 step of a native flow, counting its evaluations (the search's unit of work)
let evals = 0;
function rk4n(f, p, h) {
  const g = f.z || f; let k = g(p[0], p[1], p[2]); const a0 = k[0], a1 = k[1], a2 = k[2];
  k = g(p[0] + h / 2 * a0, p[1] + h / 2 * a1, p[2] + h / 2 * a2); const b0 = k[0], b1 = k[1], b2 = k[2];
  k = g(p[0] + h / 2 * b0, p[1] + h / 2 * b1, p[2] + h / 2 * b2); const c0 = k[0], c1 = k[1], c2 = k[2];
  k = g(p[0] + h * c0, p[1] + h * c1, p[2] + h * c2); const d0 = k[0], d1 = k[1], d2 = k[2];
  evals += 4;
  return [p[0] + h / 6 * (a0 + 2 * b0 + 2 * c0 + d0), p[1] + h / 6 * (a1 + 2 * b1 + 2 * c1 + d1), p[2] + h / 6 * (a2 + 2 * b2 + 2 * c2 + d2)];
}
const out3 = (p) => !(Math.abs(p[0]) + Math.abs(p[1]) + Math.abs(p[2]) < 1e3);   // escaped, or NaN
function eig3(A) {   // a symmetric 3x3: eigenvalues (descending) and their vectors (columns), by Jacobi rotations
  let a = A.map((r) => r.slice()), V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sw = 0; sw < 60; sw++) {
    let p = 0, qq = 1, m = Math.abs(a[0][1]); if (Math.abs(a[0][2]) > m) { m = Math.abs(a[0][2]); qq = 2; } if (Math.abs(a[1][2]) > m) { m = Math.abs(a[1][2]); p = 1; qq = 2; }
    if (m < 1e-15) break;
    const th = 0.5 * Math.atan2(2 * a[p][qq], a[qq][qq] - a[p][p]), cs = Math.cos(th), sn = Math.sin(th);
    for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][qq]; a[k][p] = cs * x - sn * y; a[k][qq] = sn * x + cs * y; }
    for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[qq][k]; a[p][k] = cs * x - sn * y; a[qq][k] = sn * x + cs * y; }
    for (let k = 0; k < 3; k++) { const x = V[k][p], y = V[k][qq]; V[k][p] = cs * x - sn * y; V[k][qq] = sn * x + cs * y; }
  }
  return [0, 1, 2].map((i) => ({ v: a[i][i], e: [V[0][i], V[1][i], V[2][i]] })).sort((x, y) => y.v - x.v);
}
// The checks, in order, with the reason each rejects:
const VET = { lamT: 0.05, dky: 2.5, med: 0.25, a2: 0.3, a3: 0.12, cov: 0.07, stiff: 30, escGPU: 0.016, lamCarried: 0.02, near: 0.2, maxSteps: 300000, formOnly: false };
const SLICE = 250;   // RK4 steps between yields: one slice is 1000-2000 evaluations
// vet a candidate {f, p0, dt}; fills o with its measures, and o.why with the first check it failed (none: it passes). It
// yields every SLICE steps, so the search never holds a frame. `from` is the shape on screen (for the carried check).
function* vet(cand, o, from) {
  const f = cand.f, dt = cand.dt; let p = cand.p0.slice(), n = 0;
  // 1. it settles: no escape, no fixed point
  for (let i = 0; i < 2000; i++) { p = rk4n(f, p, dt); if (out3(p)) { o.why = 'escapes'; return; } if (++n % SLICE === 0) yield; }
  // 2. its turnover: the 97th-percentile radius over its mean speed (native time), from 4000 steps
  let sp = 0, c = [0, 0, 0]; const look = [];
  for (let i = 0; i < 4000; i++) { p = rk4n(f, p, dt); if (out3(p)) { o.why = 'escapes'; return; } if (i % 8 === 0) { look.push(p); const v = f(p[0], p[1], p[2]); sp += Math.hypot(v[0], v[1], v[2]); } if (++n % SLICE === 0) yield; }
  sp /= look.length; for (const v of look) for (let j = 0; j < 3; j++) c[j] += v[j] / look.length;
  const r0 = look.map((v) => Math.hypot(v[0] - c[0], v[1] - c[1], v[2] - c[2])).sort((x, y) => x - y)[Math.floor(look.length * 0.97)];
  if (!(sp > 1e-6 * Math.max(r0, 1e-9)) || !(r0 > 1e-6)) { o.why = 'fixed point'; return; }
  const turn = r0 / sp, nT = Math.ceil(100 * turn / dt), nW = Math.ceil(150 * turn / dt);
  if (nT + 2 * nW > VET.maxSteps) { o.why = 'too slow'; return; }
  // 3. 100 turnovers let go, then two windows of 150: the largest Lyapunov exponent in each (a pair 1e-7 apart, set back
  //    each step), the mean divergence (so the third exponent, the second being 0 for a flow), an orbit sample of ~6000
  for (let i = 0; i < nT; i++) { p = rk4n(f, p, dt); if (out3(p)) { o.why = 'escapes'; return; } if (++n % SLICE === 0) yield; }
  const every = Math.max(1, Math.floor(2 * nW / 6000)), pts = [], lam = [0, 0]; let qv = [p[0] + 1e-7, p[1], p[2]], dv = 0, nd = 0;
  for (let w = 0; w < 2; w++) for (let i = 0; i < nW; i++) {
    p = rk4n(f, p, dt); qv = rk4n(f, qv, dt); if (out3(p)) { o.why = 'escapes'; return; }
    const d = Math.hypot(qv[0] - p[0], qv[1] - p[1], qv[2] - p[2]); if (!(d > 0)) { o.why = 'fixed point'; return; }
    lam[w] += Math.log(d / 1e-7); qv = [p[0] + (qv[0] - p[0]) * 1e-7 / d, p[1] + (qv[1] - p[1]) * 1e-7 / d, p[2] + (qv[2] - p[2]) * 1e-7 / d];
    if (i % every === 0) {
      pts.push(p);
      for (let j = 0; j < 3; j++) { const a = p.slice(), b = p.slice(); a[j] += 1e-5; b[j] -= 1e-5; dv += (f(a[0], a[1], a[2])[j] - f(b[0], b[1], b[2])[j]) / 2e-5; } nd++; evals += 6;
    }
    if (++n % SLICE === 0) yield;
  }
  o.steps = n; o.turn = turn;
  o.lamT = [lam[0] / (nW * dt) * turn, lam[1] / (nW * dt) * turn];   // per turnover
  o.lam = (lam[0] + lam[1]) / (2 * nW * dt);   // per unit of native time
  if (Math.min(o.lamT[0], o.lamT[1]) < VET.lamT) { o.why = 'no chaos'; return; }   // a cycle, torus or fixed point reads ~0 or less
  const div = dv / nd, lam3 = div - o.lam; o.dky = lam3 < 0 ? 2 + o.lam / -lam3 : 3; o.div = div;
  if (o.dky > VET.dky) { o.why = 'not contracting'; return; }   // a near-conservative flow: no attractor for the cloud to settle on
  // 4. its form, in its own frame: centre, scale (97th-percentile radius), principal axes, spread, coverage
  // (in slices of 1000 points, each counted as 4000 evaluations: its time measured against the steps')
  const N = pts.length, PK = 1000, PW = 4000; c = [0, 0, 0]; for (const v of pts) for (let j = 0; j < 3; j++) c[j] += v[j] / N;
  const rr = new Float64Array(N); for (let i = 0; i < N; i++) { const v = pts[i]; rr[i] = Math.hypot(v[0] - c[0], v[1] - c[1], v[2] - c[2]); }
  rr.sort(); const s = rr[Math.floor(N * 0.97)]; evals += PW; yield;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; let spd = 0; const G = 16, occ = new Set();
  for (let i = 0; i < N; i++) {
    const v = pts[i], g = f(v[0], v[1], v[2]); spd += Math.hypot(g[0], g[1], g[2]) / s;
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += (v[a] - c[a]) * (v[b] - c[b]) / N;
    const gx = Math.floor(((v[0] - c[0]) / s + 1) / 2 * G), gy = Math.floor(((v[1] - c[1]) / s + 1) / 2 * G), gz = Math.floor(((v[2] - c[2]) / s + 1) / 2 * G);
    if (gx >= 0 && gx < G && gy >= 0 && gy < G && gz >= 0 && gz < G) occ.add((gx * G + gy) * G + gz);
    if (i % PK === PK - 1) { evals += PW; yield; }
  }
  spd /= N; const E = eig3(C), sd = E.map((e) => Math.sqrt(Math.max(e.v, 0)));
  Object.assign(o, { c, s, E, k: TARGET / spd, med: rr[N >> 1] / s, a2: sd[1] / sd[0], a3: sd[2] / sd[0], cov: occ.size / (G * G * G * Math.PI / 6), pts });
  o.stiff = o.k * -lam3;   // the fastest contraction, per second of the screen's clock
  if (o.med < VET.med) { o.why = 'thin body'; return; }
  if (o.a2 < VET.a2) { o.why = 'needle'; return; }
  if (o.a3 < VET.a3) { o.why = 'flat'; return; }
  if (o.cov < VET.cov) { o.why = 'sparse'; return; }
  if (o.stiff > VET.stiff) { o.why = 'stiff'; return; }
  yield;
  if (VET.formOnly) return;   // capture's ?shape= draws a candidate whatever the checks say: its frame and points only
  // 4b. no stable fixed point on the stage: Newton's method from the centre, 64 orbit points and a 5x5x5 lattice of the
  //     unit ball (to radius 2.6); a fixed point whose Jacobian passes Routh-Hurwitz (every eigenvalue's real part
  //     negative) inside radius 2.6 rejects. It would catch carried points and hold them as a bright dot: textbook Aizawa
  //     has one at z = -1.105 (radius 1.22); Lorenz has two wherever rho is under sigma(sigma+beta+3)/(sigma-beta-1)
  {
    const fr = frameOf(cand, o), st = [c]; for (let i = 0; i < 64; i++) st.push(pts[Math.floor(i * N / 64)]);
    for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) for (let e = 0; e < 5; e++) { const u = [(a - 2) * 1.2, (b - 2) * 1.2, (e - 2) * 1.2]; if (Math.hypot(u[0], u[1], u[2]) <= 2.6) st.push(fromUnit(fr, u)); }
    for (let i = 0; i < st.length; i++) {
      const q = stableFixed(f, st[i]);   // it charges its own work
      if (q && Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]) <= 2.6 * s) { o.why = 'a stable fixed point'; o.fixed = q; return; }
      if (i % 4 === 3) yield;
    }
  }
  // 5. as the screen steps it: 128 points of the orbit, in unit space, RK2 at 1/120 s for 60 s, as the shader does; a
  //    point past radius 2.6 is reborn there, so few may leave: at most 2 (64 points for 30 s, at most 2, passed flows
  //    that lost 6-7% in 60 s)
  const sh = frameOf(cand, o), G1 = (u) => G1u(sh, u); let esc = 0;
  for (let i = 0; i < 128; i++) {
    const v = pts[Math.floor(rnd5() * N)]; let u = toUnit(sh, v);
    for (let t = 0; t < 7200; t++) { const k1 = G1(u), k2 = G1([u[0] + k1[0] / 240, u[1] + k1[1] / 240, u[2] + k1[2] / 240]); u = [u[0] + k2[0] / 120, u[1] + k2[1] / 120, u[2] + k2[2] / 120];
      if (!(Math.hypot(u[0], u[1], u[2]) <= 2.6)) { esc++; break; } if (t % 300 === 299) yield; }
  }
  o.escGPU = esc / 128; if (o.escGPU > VET.escGPU) { o.why = 'escapes on screen'; return; }
  // 5b. it lasts: 6 orbit points each followed 400 turnovers (at up to 100 steps a turnover), with a pair. One that leaves
  //     (|x|+|y|+|z| over 1e3) is *leaks*: a slow leak the 400 turnovers above and the 60 s on screen can miss (2 of 600
  //     flows, by an independent check). Lambda under 0.02 a turnover over turnovers 200-400 is *chaos fades*: a chaotic
  //     transient that ends on a cycle (1 of 600 reached a period-14 cycle after turnover 1000)
  {
    const hl = Math.max(dt, turn / 100), mL = Math.ceil(400 * turn / hl);
    for (let i = 0; i < 6; i++) {
      let pc = pts[Math.floor(rnd5() * N)], qc = [pc[0] + 1e-7, pc[1], pc[2]], L = 0;
      for (let t = 0; t < mL; t++) {
        pc = rk4n(f, pc, hl); if (out3(pc)) { o.why = 'leaks'; return; }
        if (t >= mL / 2) { qc = rk4n(f, qc, hl); const dd = Math.hypot(qc[0] - pc[0], qc[1] - pc[1], qc[2] - pc[2]); if (!(dd > 0)) { L = -1e9; break; }
          L += Math.log(dd / 1e-7); qc = [pc[0] + (qc[0] - pc[0]) * 1e-7 / dd, pc[1] + (qc[1] - pc[1]) * 1e-7 / dd, pc[2] + (qc[2] - pc[2]) * 1e-7 / dd]; }
        else qc = [pc[0] + 1e-7, pc[1], pc[2]];
        if (t % SLICE === 0) yield;
      }
      if (!(L / ((mL - Math.ceil(mL / 2)) * hl) * turn >= VET.lamCarried)) { o.why = 'chaos fades'; return; }
    }
  }
  // 6. carried: 16 points of the shape on screen through the 10 s blend into this one (as the shader blends), then each
  //    followed natively for 250 turnovers (150 let through a flow whose carried points left its attractor for a torus
  //    later), or for 8 e-folds at this shape's own rate if that is longer (Aizawa, 0.04 a
  //    turnover, read under 0.01 on a shorter run: its textbook point failed), at up to 100 steps a turnover: a point caught
  //    by a second, non-chaotic attractor reads lambda ~0 over the last two thirds. A point that leaves radius 2.6, in the
  //    blend or after, is reborn on this shape's own points, as on screen. (8 points for 60 turnovers let through 9 of 150
  //    shapes of an earlier search whose carried points sat on a cycle or a fixed point, by an independent check.)
  //    The page always has a shape on screen; the node checks vet without one (from null: no carried check)
  if (from) {
    const lamC = [], hf = Math.max(dt, turn / 100), m = Math.ceil(Math.max(250, 8 / Math.min(...o.lamT)) * turn / hf), R = 2.6 * sh.s;
    for (let i = 0; i < 16; i++) {
      const d = from.seedData, j = Math.floor(rnd5() * 4096) * 4; let u = [d[j], d[j + 1], d[j + 2]], gone = false;
      for (let t = 0; t < 1200 && !gone; t++) { const w = sstep(t / 1200), Gm = (x) => mix3(G1u(from, x), G1u(sh, x), w);
        const k1 = Gm(u), k2 = Gm([u[0] + k1[0] / 240, u[1] + k1[1] / 240, u[2] + k1[2] / 240]); u = [u[0] + k2[0] / 120, u[1] + k2[1] / 120, u[2] + k2[2] / 120];
        if (!(Math.hypot(u[0], u[1], u[2]) <= 2.6)) gone = true; if (t % 150 === 149) yield; }
      if (gone) continue;
      let pc = fromUnit(sh, u), qc = [pc[0] + 1e-7, pc[1], pc[2]], L = 0;
      for (let t = 0; t < m && !gone; t++) { pc = rk4n(f, pc, hf); qc = rk4n(f, qc, hf);
        if (!(Math.hypot(pc[0] - sh.c[0], pc[1] - sh.c[1], pc[2] - sh.c[2]) <= R)) { gone = true; break; }
        const dd = Math.hypot(qc[0] - pc[0], qc[1] - pc[1], qc[2] - pc[2]); if (!(dd > 0)) { L = -1e9; break; }
        if (t > m / 3) L += Math.log(dd / 1e-7); qc = [pc[0] + (qc[0] - pc[0]) * 1e-7 / dd, pc[1] + (qc[1] - pc[1]) * 1e-7 / dd, pc[2] + (qc[2] - pc[2]) * 1e-7 / dd];
        if (t % SLICE === 0) yield; }
      if (!gone) lamC.push(L / ((m - Math.floor(m / 3)) * hf) * turn);
    }
    o.lamCarried = lamC; if (lamC.some((l) => !(l >= VET.lamCarried))) { o.why = 'carried onto a cycle'; return; }
    // 7. a stable fixed point beside the attractor catches a small share of the carried points, and a few hundred grains on
    //    one pixel are a bright dot (16 points missed shares of a few percent: Aizawa, 3 of 150 dial-walk shapes, since deleted): 48 more points
    //    through the blend, then 60 turnovers natively; one that has all but stopped (its speed under 1/1000 of the mean)
    //    rejects, and so does one whose lambda over turnovers 20-60 is under 0.01 (8 of 1200 shapes had a carried point
    //    under 0.01 by the independent check, which 16 points missed)
    const m2 = Math.ceil(60 * turn / hf);
    for (let i = 0; i < 48; i++) {
      const d = from.seedData, j = Math.floor(rnd5() * 4096) * 4; let u = [d[j], d[j + 1], d[j + 2]], gone = false;
      for (let t = 0; t < 1200 && !gone; t++) { const w = sstep(t / 1200), Gm = (x) => mix3(G1u(from, x), G1u(sh, x), w);
        const k1 = Gm(u), k2 = Gm([u[0] + k1[0] / 240, u[1] + k1[1] / 240, u[2] + k1[2] / 240]); u = [u[0] + k2[0] / 120, u[1] + k2[1] / 120, u[2] + k2[2] / 120];
        if (!(Math.hypot(u[0], u[1], u[2]) <= 2.6)) gone = true; if (t % 150 === 149) yield; }
      if (gone) continue;
      let pc = fromUnit(sh, u), qc = [pc[0] + 1e-7, pc[1], pc[2]], L = 0;
      for (let t = 0; t < m2; t++) { pc = rk4n(f, pc, hf); if (!(Math.hypot(pc[0] - sh.c[0], pc[1] - sh.c[1], pc[2] - sh.c[2]) <= R)) { gone = true; break; }
        if (t >= m2 / 3) { qc = rk4n(f, qc, hf); const dd = Math.hypot(qc[0] - pc[0], qc[1] - pc[1], qc[2] - pc[2]); if (!(dd > 0)) { L = -1e9; break; }
          L += Math.log(dd / 1e-7); qc = [pc[0] + (qc[0] - pc[0]) * 1e-7 / dd, pc[1] + (qc[1] - pc[1]) * 1e-7 / dd, pc[2] + (qc[2] - pc[2]) * 1e-7 / dd]; }
        else qc = [pc[0] + 1e-7, pc[1], pc[2]];
        if (t % SLICE === 0) yield; }
      if (gone) continue;
      const v = f(pc[0], pc[1], pc[2]); if (!(Math.hypot(v[0], v[1], v[2]) >= 1e-3 * sp)) { o.why = 'carried onto a fixed point'; return; }
      // and its lambda over turnovers 20-60 (a short window: half the threshold of the 16 above)
      if (!(L / ((m2 - Math.ceil(m2 / 3)) * hf) * turn >= VET.lamCarried / 2)) { o.why = 'carried onto a cycle'; return; }
    }
  }
}
// Newton's method from p for a fixed point of f (a central-difference Jacobian); returns it if it is stable (Routh-Hurwitz on
// the Jacobian's characteristic polynomial), else null
function jac3(f, p) { const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (let j = 0; j < 3; j++) { const a = p.slice(), b = p.slice(), e = 1e-6 * Math.max(1, Math.abs(p[j])); a[j] += e; b[j] -= e; const fa = f(a[0], a[1], a[2]), fb = f(b[0], b[1], b[2]); for (let i = 0; i < 3; i++) J[i][j] = (fa[i] - fb[i]) / (2 * e); } return J; }
const det3 = (J) => J[0][0] * (J[1][1] * J[2][2] - J[1][2] * J[2][1]) - J[0][1] * (J[1][0] * J[2][2] - J[1][2] * J[2][0]) + J[0][2] * (J[1][0] * J[2][1] - J[1][1] * J[2][0]);
// It charges 8 evaluations for each of its own (7 an iteration: the flow and a 6-point Jacobian), as each costs 7.4 an RK4
// stage's (node, warmed); a flat 400 a solve let one frame hold 98 solves of up to 30 iterations
function stableFixed(f, p0) {
  let p = p0.slice();
  for (let it = 0; it < 30; it++) {
    evals += 56;
    const F = f(p[0], p[1], p[2]), J = jac3(f, p), D = det3(J); if (!(Math.abs(D) > 1e-14)) return null;
    const d = [0, 1, 2].map((k) => det3(J.map((r, i) => r.map((v, j) => (j === k ? F[i] : v)))) / D);
    p = [p[0] - d[0], p[1] - d[1], p[2] - d[2]]; if (!(Math.abs(p[0]) + Math.abs(p[1]) + Math.abs(p[2]) < 1e4)) return null;
    if (Math.hypot(d[0], d[1], d[2]) < 1e-10 * Math.max(1, Math.hypot(p[0], p[1], p[2]))) break;
  }
  evals += 56; const F = f(p[0], p[1], p[2]); if (!(Math.hypot(F[0], F[1], F[2]) < 1e-8)) return null;
  const J = jac3(f, p), a2 = -(J[0][0] + J[1][1] + J[2][2]), a0 = -det3(J);
  const a1 = J[0][0] * J[1][1] - J[0][1] * J[1][0] + J[0][0] * J[2][2] - J[0][2] * J[2][0] + J[1][1] * J[2][2] - J[1][2] * J[2][1];
  return a2 > 0 && a0 > 0 && a2 * a1 > a0 ? p : null;
}
// a candidate's frame: centre, scale and clock from vet, the up axis its thinnest principal axis (so the camera's orbit
// looks at its face)
function frameOf(cand, o) {
  const ey = norm(o.E[2].e), ex = norm(cross(ey, Math.abs(ey[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])), ez = cross(ex, ey);
  return { f: cand.f, c: o.c, s: o.s, k: o.k, ex, ey, ez, M: [ex[0], ey[0], ez[0], ex[1], ey[1], ez[1], ex[2], ey[2], ez[2]] };
}
const toUnit = (Y, p) => { const d = [p[0] - Y.c[0], p[1] - Y.c[1], p[2] - Y.c[2]]; return [dot(Y.ex, d) / Y.s, dot(Y.ey, d) / Y.s, dot(Y.ez, d) / Y.s]; };
const fromUnit = (Y, u) => [0, 1, 2].map((j) => Y.c[j] + Y.s * (Y.ex[j] * u[0] + Y.ey[j] * u[1] + Y.ez[j] * u[2]));
// the screen's field of a shape at unit point u (as the shader's G1); it counts as 4 evaluations, its measured cost against
// an RK4 stage's (frames of it ran 3.5 times longer for the same count)
function G1u(Y, u) {
  const a = Y.ex, b = Y.ey, e = Y.ez, s = Y.s, f = (Y.f.z || Y.f)(Y.c[0] + s * (a[0] * u[0] + b[0] * u[1] + e[0] * u[2]), Y.c[1] + s * (a[1] * u[0] + b[1] * u[1] + e[1] * u[2]), Y.c[2] + s * (a[2] * u[0] + b[2] * u[1] + e[2] * u[2])), q = Y.k / s;
  evals += 4; return [q * (a[0] * f[0] + a[1] * f[1] + a[2] * f[2]), q * (b[0] * f[0] + b[1] * f[1] + b[2] * f[2]), q * (e[0] * f[0] + e[1] * f[1] + e[2] * f[2])];
}
// a vetted candidate becomes a shape: its frame, 4096 points of its orbit for rebirth (a texture), its measures
let liveTex = 0, discoveries = 0;
function makeShape(cand, o) {
  const Y = frameOf(cand, o); Object.assign(Y, { fam: cand.fam, P: cand.P, P30: pad30(cand.P), base: cand.base, gid: 5, p0: cand.p0, dt: cand.dt,
    lamNat: o.lam, m: { lamT: o.lamT, dky: o.dky, med: o.med, a2: o.a2, a3: o.a3, cov: o.cov, escGPU: o.escGPU } });
  const data = new Float32Array(4096 * 4);
  for (let i = 0; i < 4096; i++) { const u = toUnit(Y, o.pts[Math.floor(rnd5() * o.pts.length)]); data.set([u[0], u[1], u[2], 1], i * 4); }
  Y.seeds = tex(64, 64, gl.RGBA32F, gl.NEAREST); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 64, gl.RGBA, gl.FLOAT, data); Y.seedData = data; liveTex++;
  Y.n = ++discoveries;
  return Y;
}
function freeShape(Y) { if (Y && !Y.textbook && Y.seeds) { gl.deleteTexture(Y.seeds); Y.seeds = null; liveTex--; } }
// a mutation: each term x(1 + sd*g), or (rarely) dropped, or a new one; own: the share that mutates the discovery on screen,
// random: the share drawn at random; the rest mutate the library flow the search is on (it keeps to one for 20 tries)
const MUT = { sd: 0.2, drop: 0.03, add: 0.03, own: 0.25, random: 0.1 };
function exploreCand(from, src) {
  const r = rnd5(); let Q, base;
  if (r < MUT.random) { Q = Array.from({ length: 30 }, () => Math.round((rnd5() * 2 - 1) * 12) / 10); base = 'random'; }
  else {
    src = r < MUT.random + MUT.own && from && from.fam === 5 ? { name: from.base, Q: from.P } : src;
    const mx = Math.max(...src.Q.map(Math.abs)); base = src.name;
    Q = src.Q.map((v) => (v !== 0 ? (rnd5() < MUT.drop ? 0 : v * (1 + MUT.sd * gauss(rnd5))) : rnd5() < MUT.add ? (rnd5() * 2 - 1) * 0.3 * Math.max(1, mx / 5) : 0));
    if (from && from.fam === 5) { let a = 0, b = 0; Q.forEach((v, i) => { a += Math.abs(v - from.P[i]); b += Math.abs(from.P[i]); }); if (a < VET.near * b) return { fam: 5, P: Q, why: 'too near', base }; }
  }
  const mx = Math.max(...Q.map(Math.abs));
  return { fam: 5, P: Q, f: quadF(Q), p0: [0.1 * gauss(rnd5), 0.1 * gauss(rnd5), 0.1 * gauss(rnd5)], dt: 0.01 / Math.max(1, mx / 5), name: 'Explorer', base };
}
// the search: candidates until one passes (at most 600; then a textbook system, known good, never the shape on screen:
// returned as the next shape it would end no hold, and the hold would last for ever). Tallies every
// reason. ?rejectall=1 (capture only) rejects every candidate, the test of that fallback.
const REJECT_ALL = still && q.has('rejectall');
// ?searchthrow=1 (capture only): the first search throws on its first step, the test that a hold left with no search and
// no shape starts another (schedule())
const THROW_ONCE = still && q.has('searchthrow'); let thrown = false;
const TALLY = { tried: 0, ok: 0, why: {}, src: {} };
function* search(from) {
  if (THROW_ONCE && !thrown) { thrown = true; throw new Error('searchthrow (test)'); }
  const T = TALLY; let base = null;
  for (let t = 0; t < 600; t++) {
    // the search keeps to one library flow for 20 tries: picked per try, the flows that pass most would fill the holds
    // (Sprott B passes 7 in 10, Sprott I 1 in 9)
    if (t % 20 === 0) base = QLIB[Math.floor(rnd5() * QLIB.length)];
    const cand = exploreCand(from, base); T.tried++;
    const key = cand.base, S = T.src[key] || (T.src[key] = { tried: 0, ok: 0, why: {} }); S.tried++;
    const no = (w) => { T.why[w] = (T.why[w] || 0) + 1; S.why[w] = (S.why[w] || 0) + 1; };
    if (cand.why || REJECT_ALL) { no(cand.why || 'rejectall (test)'); yield; continue; }
    const o = {}; yield* vet(cand, o, from);
    if (o.why) { no(o.why); continue; }
    T.ok++; S.ok++;
    return makeShape(cand, o);
  }
  // one of the five textbook systems other than the one on screen
  const e = ALL.filter((i) => SYS[i] !== from);
  return SYS[e[Math.floor(rnd5() * e.length)]];
}
const BUDGET = 120000;   // the search's work a frame, in evaluations of a flow (deterministic, so a seed replays the same frames)
const SRCH = { gen: null, found: null, t0: 0, restarts: 0 }, SHAPE_ONLY = still && q.has('shape');
const WALK_EVERY = still ? Math.max(1, num('walkEvery', 1)) : 1;   // capture only: a search (Smoke's or the endless one) steps once in N frames (a check of the hold's stretch)
const endless = () => set.mode === 'discovery';
// ?shape= (capture) holds its one shape for the whole run: no search
function startSearch() { if (SHAPE_ONLY) return; if (SRCH.found && SRCH.found !== curSh && SRCH.found !== nxtSh) freeShape(SRCH.found); SRCH.found = null; SRCH.gen = search(curSh); SRCH.t0 = simT; }
function searchStep() {
  if (!SRCH.gen) return;
  if (WALK_EVERY > 1 && Math.round(frames) % WALK_EVERY) return;   // capture only: a slow search (the hold's stretch)
  const t0 = performance.now();
  const e0 = evals; let worst = 0, we = 0, done = false;
  const mem = performance.memory, h0 = mem ? mem.usedJSHeapSize : 0;
  while (evals - e0 < BUDGET) { const t1 = performance.now(), e1 = evals; let r;
    try { r = SRCH.gen.next(); } catch (err) { console.error(err); SRCH.gen = null; break; }   // schedule() starts another
    const d = performance.now() - t1; if (d > worst) { worst = d; we = evals - e1; }
    if (r.done) { SRCH.found = r.value || null; SRCH.gen = null; SRCH.took = simT - SRCH.t0; done = true; break; } }
  const ms = performance.now() - t0; searchMs = Math.max(searchMs, ms);
  // a frame over 16 ms is kept (the last 8): its time, its work, its slowest step and that step's work, whether it found,
  // the heap's change over the frame in MB (a large drop: a collection ran inside it), and the wall clock (ms since 1970,
  // to match the frame against the OS scheduler's record of the page's thread)
  if (ms > 16) { slowSearch.push([+ms.toFixed(1), evals - e0, +worst.toFixed(1), we, done, mem ? +((mem.usedJSHeapSize - h0) / 1e6).toFixed(2) : null, Date.now()]); if (slowSearch.length > 8) slowSearch.shift(); if (still || LIVETEST) performance.mark('slow search ' + ms.toFixed(1)); }   // the mark finds it in a performance trace (checks only: user timing keeps every mark)
}
const slowSearch = [];

// ---- particles: core rows then dust rows; A = (pos, rand), B = (vel, age); a caught grain of dust has a negative age ----
const PW = 512, STRK = 4;   // points per particle along its frame step
let NC = 0, ND = 0, PH = 0, NP = 0, ps = null, pi = 0;
const simProg = prog(FSV, `#version 300 es
precision highp float; precision highp sampler2D;
uniform sampler2D SA, SB, seeds; uniform float dt, t, salt, nc, sub, seekOn, rebirth;
layout(location = 0) out vec4 oA; layout(location = 1) out vec4 oB;
${FIELD_GLSL}
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + salt) * 43758.5453); }
vec3 abc(vec3 p){ float ph = t * .03; vec3 q = p * 1.1;
  return vec3(sin(q.z + ph) + .8 * cos(q.y - ph), .9 * sin(q.x + 1.7 * ph) + sin(q.z * .7), .8 * sin(q.y + 2.1) + .9 * cos(q.x * 1.3 + ph)); }
vec3 reborn(vec2 fc){ ivec2 c = ivec2(h(fc) * 64., h(fc + 3.7) * 64.); return texelFetch(seeds, c, 0).xyz + (vec3(h(fc + 1.1), h(fc + 2.3), h(fc + 5.9)) - .5) * .02; }
void main(){ vec2 fc = gl_FragCoord.xy; ivec2 c = ivec2(fc); vec4 A = texelFetch(SA, c, 0), B = texelFetch(SB, c, 0);
  vec3 u = A.xyz, v = B.xyz; float age = B.w + dt * sub;
  if (fc.y < nc) {                                    // core: the attractor's own particles, RK2 midpoint
    for (int i = 0; i < 8; i++) { if (float(i) >= sub) break; vec3 k1 = G(u); vec3 k2 = G(u + .5 * dt * k1); u += dt * k2; v = k2; }
    // out of bounds, or a slow random rebirth (fast while a new attractor fills in): the cloud covers the whole attractor
    if (any(isnan(u)) || length(u) > 2.6 || h(fc + 13.1) < rebirth * dt * sub) { u = reborn(fc); v = G(u); age = 0.; }
  } else {                                            // dust: drifts on the ABC flow; seekers are caught by the attractor
    bool caught = B.w < 0.; age = abs(B.w) + dt * sub;
    float phase = sin(t * (.05 + .1 * A.w) + A.w * 40.), hold = smoothstep(-.35, .25, phase);
    bool seeker = seekOn > .5 && A.w < .35 && hold > .5;
    vec3 sp = texelFetch(seeds, ivec2(int(A.w * 4096.) % 64, int(A.w * 64.)), 0).xyz;
    if (caught && (!seeker || length(u) > 2.6)) { caught = false; v = v * 1.2 + normalize(u + 1e-4) * .3; }
    for (int i = 0; i < 8; i++) { if (float(i) >= sub) break;
      if (caught) { vec3 k1 = G(u); vec3 k2 = G(u + .5 * dt * k1); u += dt * k2; v = k2; continue; }
      vec3 vt = abc(u) * .07, d = sp - u; float rate = .35;
      if (seeker) { vt = d * min(1.2, .35 / max(length(d), 1e-3)); rate = 2.; }
      v += (vt - v) * (1. - exp(-dt * rate)); u += dt * v;
      if (seeker && length(sp - u) < .05) { caught = true; v = G(u); } }
    // reborn in the outer shell, fading in: when it leaves, or after a lifetime of 60-120 s
    if (any(isnan(u)) || length(u) > 4.2 || age > 60. + 60. * A.w) {
      vec3 dd = normalize(vec3(h(fc), h(fc + 1.3), h(fc + 2.9)) - .5); u = dd * (1.8 + 2.4 * h(fc + 7.7)); v = abc(u) * .07; age = 0.; caught = false; }
    if (caught) age = -age;
  }
  oA = vec4(u, A.w); oB = vec4(v, age); }`);
const initProg = prog(FSV, `#version 300 es
precision highp float; precision highp sampler2D; uniform sampler2D seeds; uniform float salt, nc;
layout(location = 0) out vec4 oA; layout(location = 1) out vec4 oB;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + salt) * 43758.5453); }
void main(){ vec2 fc = gl_FragCoord.xy; float rr = h(fc + 9.1);
  if (fc.y < nc) { ivec2 c = ivec2(h(fc) * 64., h(fc + 3.7) * 64.); oA = vec4(texelFetch(seeds, c, 0).xyz + (vec3(h(fc + 1.1), h(fc + 2.3), h(fc + 5.9)) - .5) * .05, rr); }
  else { vec3 d = normalize(vec3(h(fc), h(fc + 1.3), h(fc + 2.9)) - .5); oA = vec4(d * (.6 + 3.4 * pow(h(fc + 7.7), .5)), rr); }
  oB = vec4(0., 0., 0., 10.); }`);
// points: projected sparkles, coloured by speed relative to the field's mean
const ptProg = prog(`#version 300 es
precision highp float; precision highp sampler2D;
uniform sampler2D SA, SB; uniform mat4 VP, VPp; uniform vec2 res; uniform float pxScale, t, nc, gain, dustGain, nearFade, focus, bokeh, strk, fdt;
uniform vec3 cSlow, cMid, cFast, dustTint;
out vec3 col; out float psz;
float h1(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
void main(){ int K = int(strk), id = gl_VertexID / K, j = gl_VertexID - id * K; ivec2 c = ivec2(id % ${PW}, id / ${PW}); vec4 A = texelFetch(SA, c, 0), B = texelFetch(SB, c, 0);
  bool dust = float(c.y) >= nc;
  // K points along this frame's step on screen (its own motion and the camera's, from the last frame's view to this one)
  float fj = float(j) / strk;
  vec4 P0 = VP * vec4(A.xyz, 1.), P1 = VPp * vec4(A.xyz - B.xyz * fdt, 1.), P = mix(P0, P1, fj); gl_Position = P;
  float stepPx = length((P0.xy / max(P0.w, .02) - P1.xy / max(P1.w, .02)) * res * .5) / strk;   // gap between its K points
  float depth = max(P.w, .02);
  float r = A.w, sp = length(B.xyz) / ${TARGET.toFixed(3)};
  float tcol = smoothstep(.35, 1.9, sp);
  vec3 cc = tcol < .5 ? mix(cSlow, cMid, tcol * 2.) : mix(cMid, cFast, tcol * 2. - 1.);
  float spark = .35 + 2.6 * pow(r, 7.);                         // most faint, a few bright
  float tw = .65 + .35 * sin(t * (2. + 5. * h1(r * 91.)) + r * 300.);  // each twinkles at its own rate
  float b = gain * spark * tw / strk;
  float sz = pxScale * (1. + 1.4 * pow(r, 5.)) * (3.2 / depth);
  if (dust) { float cap = B.w < 0. ? 1. : 0., ag = abs(B.w);
    cc = mix(dustTint, cc, cap); b = dustGain / strk * mix(.55, 1., cap) * (.4 + 1.6 * pow(r, 4.)) * tw * smoothstep(0., 4., ag) * smoothstep(60. + 60. * r, 55. + 60. * r, ag); sz *= .9;   // fades in, and out before its lifetime rebirth
    // depth of field: dust far from the focal plane (the sculpture) opens into soft discs, its light spread over the disc
    float coc = abs(1. / depth - 1. / focus) * focus * bokeh * pxScale;
    float big = sqrt(sz * sz + coc * coc); b *= sz * sz / (big * big) * mix(1., 2.2, smoothstep(2., 10., big)); sz = big; }
  b *= smoothstep(.15, nearFade, depth);                         // nothing blooms up into the lens
  float szc = clamp(sz, 1., dust ? 28. : 7.); b *= sz * sz / (szc * szc);    // a point too small to draw keeps its light
  b *= smoothstep(2.5, 1.5, stepPx / max(szc, 4.));   // too fast to streak (near the lens): it would jump as dots, so it fades
  gl_PointSize = szc + 1.5; psz = szc; col = cc * b; }`, `#version 300 es
precision highp float; in vec3 col; in float psz; out vec4 o;
void main(){ vec2 d = (gl_PointCoord - .5) * (psz + 1.5); float r2 = dot(d, d);
  float a = exp(-r2 / max(.18, psz * psz * .12));
  if (psz > 6.) { float rr = sqrt(r2) / (psz * .5); a = smoothstep(1., .82, rr) * (.75 + .25 * smoothstep(.5, .95, rr)); }
  o = vec4(col * a, 1.); }`);
function allocParticles() {
  const Q = QUALITY[set.quality];
  if (ps) ps.forEach((s) => { gl.deleteTexture(s.a); gl.deleteTexture(s.b); gl.deleteFramebuffer(s.fb); });
  NC = Q.nc; ND = Q.nd; PH = NC + ND; NP = PW * PH;
  ps = [0, 1].map(() => { const a = tex(PW, PH, gl.RGBA32F, gl.NEAREST), b = tex(PW, PH, gl.RGBA32F, gl.NEAREST); return { a, b, fb: fbo(a, b) }; }); pi = 0;
  initParticles(PH);
}
function initParticles(rows) {   // rows = PH: everything; rows = NC: the core only (back from Smoke), the dust keeps drifting
  gl.bindFramebuffer(gl.FRAMEBUFFER, ps[pi].fb); gl.viewport(0, 0, PW, rows); gl.useProgram(initProg.p); gl.disable(gl.BLEND);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, curSh.seeds); gl.uniform1i(initProg.u.seeds, 0);
  gl.uniform1f(initProg.u.salt, rnd() * 100); gl.uniform1f(initProg.u.nc, NC); gl.bindVertexArray(vao0); gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// ---- the shape schedule (Discovery and Classic): hold, then blend the two fields over BLEND s ----
const BLEND = 10, SUB = 4;
let curId = 0, nextId = 0, phT0 = 0, morphW = 0, switches = 0;
let curSh = null, nxtSh = null;   // the shapes on screen: curId and nextId are their families (5: a found flow)
const ALL = [0, 1, 2, 3, 4];   // the five textbook systems: Discovery's opening and fallback draw from them; Classic shows them
function nextOf(id) { const e = ALL.filter((i) => i !== id); return e[Math.floor(rnd6() * e.length)]; }   // Classic: any other, at random
// rebirth per second: a trickle always; while the new field takes over and for 12 s after, enough to fill it evenly
const rebirthRate = (ph) => { const sinceSwitch = ph < set.hold ? ph : -1;
  return 0.004 + 0.09 * Math.max(sstep((ph - set.hold - BLEND * 0.5) / (BLEND * 0.5)) * (ph >= set.hold ? 1 : 0), sinceSwitch >= 0 && switches > 0 ? 1 - sstep(sinceSwitch / 12) : 0); };

// ---- camera: a slow orbit; the unit sphere fills 78% of the short side ----
let lastVP = null;
function camera(tS) {
  const az = tS * 2 * Math.PI / 110 + 0.6, el = 0.85 + 0.5 * Math.sin(tS * 2 * Math.PI / 77);
  const fov = 34 * Math.PI / 180, short = Math.min(W, H) / H;
  const dist = 1.08 / (Math.tan(fov / 2) * short * 0.78);
  const eye = [dist * Math.cos(el) * Math.cos(az), dist * Math.sin(el), dist * Math.cos(el) * Math.sin(az)];
  const f = norm([-eye[0], -eye[1], -eye[2]]), r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
  const view = [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -dot(r, eye), -dot(u, eye), dot(f, eye), 1];
  const n = 0.05, fa = 50, ct = 1 / Math.tan(fov / 2), asp = W / H;
  const proj = [ct / asp, 0, 0, 0, 0, ct, 0, 0, 0, 0, (fa + n) / (n - fa), -1, 0, 0, 2 * fa * n / (n - fa), 0];
  const vp = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) vp[j * 4 + i] += proj[k * 4 + i] * view[j * 4 + k];
  const vpRaw = vp.slice(), oy = stageShift();   // Nerd mode in portrait: the scene moves down, below the panel
  if (oy) for (let j = 0; j < 4; j++) vp[j * 4 + 1] -= oy * 2 / H * vp[j * 4 + 3];
  return { vp, vpRaw, eye, dist };
}

// one sim step; Smoke runs only the dust rows (its core is not drawn, and is re-seeded on the way back)
function simulate(h, dustOnly) {
  const A = curSh, B = nxtSh;
  const ph = simT - phT0;
  gl.disable(gl.BLEND);
  const src = ps[pi], dst = ps[1 - pi];
  gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
  if (dustOnly) gl.viewport(0, NC, PW, ND); else gl.viewport(0, 0, PW, PH);
  gl.useProgram(simProg.p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.a); gl.uniform1i(simProg.u.SA, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, src.b); gl.uniform1i(simProg.u.SB, 1);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, (morphW > 0.5 ? B : A).seeds); gl.uniform1i(simProg.u.seeds, 2);
  gl.uniform1i(simProg.u.idA, A.gid); gl.uniform1i(simProg.u.idB, B.gid);
  setU(simProg, { PA: A.P30, PB: B.P30, cA: A.c, cB: B.c, skA: [A.s, A.k], skB: [B.s, B.k], MA: A.M, MB: B.M, wB: morphW,
    dt: h / SUB, sub: SUB, t: shaderT(), rebirth: rebirthRate(ph), salt: rnd() * 100, nc: NC, seekOn: !dustOnly && set.dust > 0 ? 1 : 0 });
  gl.bindVertexArray(vao0); gl.drawArrays(gl.TRIANGLES, 0, 3); pi = 1 - pi;
}
function schedule() {   // Discovery and Classic: hold, then blend; at the end the target becomes the current system
  let ph = simT - phT0;
  if (endless() && morphW === 0 && nxtSh === curSh && !SRCH.gen && !SRCH.found && !SHAPE_ONLY) { SRCH.restarts++; startSearch(); }   // a hold with no search and no shape found (one threw) would last for ever
  if (endless() && ph >= set.hold && morphW === 0) {   // the hold is over: the next shape is the search's, once it is found
    if (!SRCH.found) { phT0 = simT - set.hold; ph = set.hold; }   // not yet: the hold lasts
    else if (nxtSh === curSh) { nxtSh = SRCH.found; nextId = nxtSh.fam; SRCH.found = null; }
  }
  morphW = endless() && nxtSh === curSh ? 0 : sstep((ph - set.hold) / BLEND);
  return ph;
}
function endMorph() {
  if (endless()) {
    if (curSh !== nxtSh) freeShape(curSh);
    curSh = nxtSh; curId = nextId; phT0 += set.hold + BLEND; morphW = 0; switches++; themeStep(); startSearch();
    return;
  }
  curId = nextId; nextId = nextOf(curId); curSh = SYS[curId]; nxtSh = SYS[nextId]; phT0 += set.hold + BLEND; morphW = 0; switches++; themeStep();
}

// ======================================================================================================================
// Smoke: a 2D sculpture (x' = sin(P0 y) + P2 cos(P4 x), y' = sin(P1 x) + P3 cos(P5 y))
const SF32 = CBF && FBLEND;   // 32F accumulation needs float blending; else 16F
const SW = 1024, ITERS = 4, TAU = 3.5, MORPH = 25;
const stepProg = prog(FSV, `#version 300 es
precision highp float; uniform highp sampler2D st; uniform float P[6]; out vec4 o;
void main(){ vec4 s = texelFetch(st, ivec2(gl_FragCoord.xy), 0); vec2 p = s.xy;
  vec2 n = vec2(sin(P[0]*p.y) + P[2]*cos(P[4]*p.x), sin(P[1]*p.x) + P[3]*cos(P[5]*p.y));
  o = vec4(n, n - p); }`);
const seedProg = prog(FSV, `#version 300 es
precision highp float; uniform float salt; out vec4 o;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + salt) * 43758.5453); }
void main(){ vec2 c = gl_FragCoord.xy; o = vec4(h(c) * 4. - 2., h(c + 17.3) * 4. - 2., 0., 0.); }`);
// one splat per iterate, coloured by the direction of its jump (the classic way the folds read as colour)
const splatProg = prog(`#version 300 es
precision highp float; uniform highp sampler2D st; uniform int sw; uniform vec2 ctr, k; uniform vec3 C0, C1, C2;
out vec3 col;
void main(){ ivec2 c = ivec2(gl_VertexID % sw, gl_VertexID / sw); vec4 s = texelFetch(st, c, 0);
  gl_Position = vec4((s.xy - ctr) * k, 0., 1.); gl_PointSize = 1.;
  float a = atan(s.w, s.z) / 6.2831853 + 0.5;
  float t = a * 3.; col = t < 1. ? mix(C0, C1, t) : t < 2. ? mix(C1, C2, t - 1.) : mix(C2, C0, t - 2.); }`, `#version 300 es
precision highp float; in vec3 col; out vec4 o; void main(){ o = vec4(col, 1.); }`);
const showProg = prog(FSV, `#version 300 es
precision highp float; uniform sampler2D acc, echo; uniform vec2 res, pan; uniform float ang, zoom, expo, glowK, gain, lod, t, echoK, echoPow, echoLvl;
uniform vec3 bgA, bgB; out vec4 o;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + t) * 43758.5453); }
vec4 tap(vec2 uv, float l){ return (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) ? vec4(0.) : textureLod(acc, uv, l); }
void main(){
  vec2 fc = gl_FragCoord.xy, c = res * .5;
  vec2 r = (fc - c - pan) / zoom; float cs = cos(ang), sn = sin(ang); r = vec2(cs*r.x - sn*r.y, sn*r.x + cs*r.y);
  vec2 uv = (r + c) / res;
  vec4 a = tap(uv, 0.);
  // a soft, wide halo from a coarse mip: 1 + 12 taps on two rotated rings, so its blocks never read as a staircase
  vec2 px = vec2(1.) / res * exp2(lod);
  vec4 g = tap(uv, lod) * .16;
  for (int i = 0; i < 12; i++) { float a = float(i) * .5236 + (i % 2 == 0 ? 0. : .2618); float rr = i % 2 == 0 ? .9 : 1.8;
    g += tap(uv + vec2(cos(a), sin(a)) * px * rr, lod) * (i % 2 == 0 ? .09 : .05); }
  float d = a.a * expo;                          // density relative to the mean over the attractor's box
  vec3 hue = a.rgb / max(a.a, 1e-6);
  vec3 lin = hue * log(1. + d) * gain + g.rgb * expo * glowK;   // log density: faint wisps and dense folds both readable
  if (echoK > 0.) { vec2 euv = fc / res; vec3 e = vec3(0); vec2 et = vec2(2.2) / vec2(textureSize(echo, 0)); float ws = 0.;
    for (int i = 0; i < 25; i++) { vec2 o2 = vec2(i % 5 - 2, i / 5 - 2); float w = exp(-dot(o2, o2) * .35); e += texture(echo, euv + o2 * et).rgb * w; ws += w; } e /= ws;
    float el = dot(e, vec3(.3, .5, .2)) + 1e-6; lin += mix(vec3(el), e, .7) * pow(el * echoK, echoPow) / el * echoLvl; }
  vec3 col = 1. - exp(-lin);
  vec3 bg = mix(bgA, bgB, smoothstep(0., .75, length((fc - c) / max(res.x, res.y))));
  o = vec4(bg + col * (1. - bg) + (hash(fc) - .5) / 255., 1.);
}`);
const sEchoProg = prog(FSV, `#version 300 es
precision highp float; uniform sampler2D acc, prev; uniform vec2 res, eres, pan; uniform float ang, zoom, expo, lod, k; out vec4 o;
void main(){ vec2 fc = gl_FragCoord.xy / eres * res, c = res * .5;
  vec2 r = (fc - c - pan) / zoom; float cs = cos(ang), sn = sin(ang); r = vec2(cs*r.x - sn*r.y, sn*r.x + cs*r.y);
  vec2 uv = (r + c) / res; vec3 g = vec3(0); vec2 px = exp2(lod) / res;
  for (int i = 0; i < 13; i++) { float a = float(i) * 2.3998; float rr = i == 0 ? 0. : 1.6 * sqrt(float(i) / 12.);
    vec2 u2 = uv + vec2(cos(a), sin(a)) * rr * px; if (u2.x >= 0. && u2.y >= 0. && u2.x <= 1. && u2.y <= 1.) g += textureLod(acc, u2, lod).rgb; }
  o = vec4(mix(texture(prev, gl_FragCoord.xy / eres).rgb, g * expo / 13., k), 1.); }`);
// the walk: anchors known to be beautiful, steps checked on the CPU (Lyapunov exponent, coverage, aspect)
const ANCHORS = [
  [-1.4, 1.6, 1.0, 0.7, -1.4, 1.6], [1.7, 1.7, 0.6, 1.2, 1.7, 1.7], [-1.7, 1.3, -0.1, -1.2, -1.7, 1.3], [-1.8, -2.0, -0.5, -0.9, -1.8, -2.0],
  [1.5, -1.8, 1.6, 0.9, 1.5, -1.8], [1.4, 2.4, -1, -1, -2.3, -2.1], [2.01, 1.61, -1, -1, -2.53, -0.33], [-2.7, -0.86, -1, -1, -0.09, -2.2],
  [-0.827, 1.659, -1, -1, -1.637, -0.943], [-2.24, 0.43, -0.65, -2.43, -2.24, 0.43], [1.1, -1.32, -1.03, 1.54, 1.1, -1.32],
];
function analyse(P, n, s0) {
  let x = s0 ? s0[0] : 0.1, y = s0 ? s0[1] : -0.2, vx = 1, vy = 0, lyap = 0;
  const xs = new Float32Array(n), ys = new Float32Array(n);
  for (let i = -300; i < n; i++) {
    const nx = Math.sin(P[0] * y) + P[2] * Math.cos(P[4] * x), ny = Math.sin(P[1] * x) + P[3] * Math.cos(P[5] * y);
    const tx = -P[2] * P[4] * Math.sin(P[4] * x) * vx + P[0] * Math.cos(P[0] * y) * vy;   // tangent map
    const ty = P[1] * Math.cos(P[1] * x) * vx - P[3] * P[5] * Math.sin(P[5] * y) * vy;
    const m = Math.hypot(tx, ty) || 1e-12; vx = tx / m; vy = ty / m; if (i >= 0) lyap += Math.log(m);
    x = nx; y = ny; if (i >= 0) { xs[i] = x; ys[i] = y; }
  }
  const sx = Float32Array.from(xs).sort(), sy = Float32Array.from(ys).sort(), lo = Math.floor(n * 0.001), hi = Math.ceil(n * 0.999) - 1;
  const box = [sx[lo], sx[hi], sy[lo], sy[hi]];
  const G = 64, hist = new Uint32Array(G * G), bw = (box[1] - box[0]) || 1e-6, bh = (box[3] - box[2]) || 1e-6;
  for (let i = 0; i < n; i++) { const gx = Math.floor((xs[i] - box[0]) / bw * G), gy = Math.floor((ys[i] - box[2]) / bh * G);
    if (gx >= 0 && gx < G && gy >= 0 && gy < G) hist[gy * G + gx]++; }
  let occ = 0; for (let i = 0; i < G * G; i++) if (hist[i] > 1) occ++;
  return { lyap: lyap / n, cov: occ / (G * G), box, aspect: bw / bh };
}
const okEnd = (a) => a.lyap > 0.12 && a.cov > 0.2 && a.cov < 0.72 && a.aspect > 0.55 && a.aspect < 1.8;
const okMid = (a) => a.lyap > 0.06 && a.cov > 0.14;
// A stable cycle (or a closed curve) anywhere in the seeds' square catches every point in its basin, and the cloud shows it as
// a few bright points with square halos: the seeds land there at a start or a quality change, and the walk carries points
// into it (in a CPU model of the cloud, 6 of 450 walk ends caught 2-45% of it). The checks above follow one orbit, so they
// miss an attractor beside the chaotic one. lamFrom: the Lyapunov exponent of one orbit from (x, y), n steps after 300; a
// cycle of any period, a slow one, or a closed curve reads <= 0.02. stuck: how many seeds of a 16 x 16 lattice over
// [-2, 2]^2, from i0 to i1, do. A shape is shown only at 0 (a walk's end, and Smoke's start). Not covered: a quality change
// mid-morph re-seeds the square at the walk's intermediate point, which only okMid checked (rare: it needs a quality change during Smoke's 10 s morph, at a point with a cycle in the square).
function lamFrom(P, x, y, n) {
  let vx = 1, vy = 0, l = 0;
  for (let i = -300; i < n; i++) {
    const tx = -P[2] * P[4] * Math.sin(P[4] * x) * vx + P[0] * Math.cos(P[0] * y) * vy;
    const ty = P[1] * Math.cos(P[1] * x) * vx - P[3] * P[5] * Math.sin(P[5] * y) * vy;
    const m = Math.hypot(tx, ty) || 1e-12; vx = tx / m; vy = ty / m; if (i >= 0) l += Math.log(m);
    const a = Math.sin(P[0] * y) + P[2] * Math.cos(P[4] * x); y = Math.sin(P[1] * x) + P[3] * Math.cos(P[5] * y); x = a;
  }
  return l / n;
}
function stuck(P, i0, i1) {
  let n = 0;
  for (let i = i0; i < i1; i++) if (lamFrom(P, -1.875 + 0.25 * (i % 16), -1.875 + 0.25 * Math.floor(i / 16), 1000) <= 0.02) n++;
  return n;
}
// the cloud carried through a morph from P to C, as the GPU steps it (ITERS a frame, smooth5 over MORPH s): 128 points of P's
// orbit, then how many of them are stuck at C (lamFrom <= 0.02). A cycle whose basin at C is too thin for the lattice still holds points
// that it caught on the way (1 of 450 lattice-checked ends caught 3% of the CPU cloud). A generator: yields every 25 frames, and every 16 points.
function* carried(P, C, out) {
  const NP = 128, X = new Float64Array(NP), Y = new Float64Array(NP), F = MORPH * FPS;
  let x = 0.1, y = -0.2;
  for (let k = -300; k < NP; k++) { const a = Math.sin(P[0] * y) + P[2] * Math.cos(P[4] * x); y = Math.sin(P[1] * x) + P[3] * Math.cos(P[5] * y); x = a; if (k >= 0) { X[k] = x; Y[k] = y; } }
  for (let f = 1; f <= F; f++) {
    const s = smooth5(f / F), Q = P.map((v, i) => v + (C[i] - v) * s);
    for (let i = 0; i < NP; i++) { x = X[i]; y = Y[i];
      for (let k = 0; k < ITERS; k++) { const a = Math.sin(Q[0] * y) + Q[2] * Math.cos(Q[4] * x); y = Math.sin(Q[1] * x) + Q[3] * Math.cos(Q[5] * y); x = a; }
      X[i] = x; Y[i] = y; }
    if (f % 25 === 0) yield;
  }
  let n = 0;
  for (let i = 0; i < NP; i++) { if (lamFrom(C, X[i], Y[i], 1000) <= 0.02) n++; if (i % 16 === 15) yield; }
  out.n = n;
}
// the search for the next shape runs during the hold, STEPS analyses a frame. A try is one candidate and up to ten
// analyses (2 ms typical, 22 ms at worst), and one search can exhaust all 300 tries (about 0.6 s when it ran in one frame). So it never runs whole in a frame: it yields after each analysis and returns the target, or null.
const STEPS = 3;
function* pickNext(P) {
  const homeward = rnd2() < 0.25;
  for (let tries = 0; tries < 300; tries++) {
    // a step from here (reflected at the walls), or one cycle in four toward an anchor, so hours of wandering return home
    const toward = homeward || tries % 10 === 9 ? ANCHORS[Math.floor(rnd2() * ANCHORS.length)] : null;
    const C = P.map((v, i) => { const lim = i === 2 || i === 3 ? 1.7 : 3.0;
      let x = toward ? lerp(v, toward[i], 0.6 + 0.4 * rnd2()) + (rnd2() * 2 - 1) * 0.15 : v + (rnd2() * 2 - 1) * (i === 2 || i === 3 ? 0.7 : 0.9);
      if (x > lim) x = 2 * lim - x; if (x < -lim) x = -2 * lim - x; return x; });
    const end = okEnd(analyse(C, 12000)); yield; if (!end) continue;
    let good = true;
    for (let j = 1; j < 10 && good; j++) { good = okMid(analyse(P.map((v, i) => lerp(v, C[i], j / 10)), 5000)); yield; }
    for (let b = 0; b < 256 && good; b += 16) { good = stuck(C, b, b + 16) === 0; yield; }
    if (good) { const o = {}; yield* carried(P, C, o); good = o.n === 0; }
    if (good) return C;
  }
  return null;
}
function smokeSearch() {   // a few tries of the search under way; a morph waits for its target
  if (!S.search) return;
  if (WALK_EVERY > 1 && Math.round(frames) % WALK_EVERY) return;
  const t0 = performance.now();
  for (let i = 0; i < STEPS; i++) { const r = S.search.next(); if (r.done) { S.to = r.value || S.from; S.search = null; break; } }
  searchMs = Math.max(searchMs, performance.now() - t0);
}
let searchMs = 0;   // the most one frame's search took (state(), for the checks)
// Smoke's start is an anchor that passes the walk's end checks (okEnd, stuck). One anchor ([-2.24, 0.43, ...]) is a period-4
// orbit (lambda -0.17 from every start), and a first entry on it drew four bright dots (2 of 9 fresh pages). The
// anchors are constants, so the ones that pass are listed here, and a check fails if the list and the checks
// disagree: 2 (aspect 0.53), 4 (a cycle beside its attractor) and 9 never start. Run in the page, the checks took about
// 27 ms an anchor in the frame Smoke starts (the live check saw a 100 ms gap).
const START_ANCHORS = [0, 1, 3, 5, 6, 7, 8, 10];
let S = null;   // Smoke's state; null outside Smoke (its buffers are freed)
function smokeStart() {
  const Q = QUALITY[set.quality];
  let P = null; for (let i = 0; i < 20 && !P; i++) { const k = Math.floor(rnd2() * ANCHORS.length); if (START_ANCHORS.includes(k)) P = ANCHORS[k].slice(); }
  if (!P) P = ANCHORS[START_ANCHORS[0]].slice();   // never an unchecked start
  S = { SH: Q.sh, st: [rt(SW, Q.sh, gl.RGBA32F, gl.NEAREST), rt(SW, Q.sh, gl.RGBA32F, gl.NEAREST)], si: 0, acc: null, echo: null, ei: 0, accFrames: 0,
    cur: P.slice(), from: P, to: null, search: pickNext(P), phase: 0, morphT: 0, box: null };
  smokeTargets();
  draw(seedProg, S.st[S.si], {}, { salt: rnd2() * 100 });
  for (let i = 0; i < 40; i++) smokeIterate();   // run off the transient before anything is drawn
  smokeBox(1);
}
function smokePoints() {   // a quality change in Smoke: new point buffers at the new count, the same walk and framing (no cut)
  free(...S.st); S.SH = QUALITY[set.quality].sh;
  S.st = [rt(SW, S.SH, gl.RGBA32F, gl.NEAREST), rt(SW, S.SH, gl.RGBA32F, gl.NEAREST)]; S.si = 0;
  draw(seedProg, S.st[S.si], {}, { salt: rnd2() * 100 }); for (let i = 0; i < 40; i++) smokeIterate();
}
function smokeStop() { if (!S) return; free(...S.st, S.acc, ...(S.echo || [])); S = null; }
function smokeTargets() {   // the accumulation (mipmapped) and the echo follow the screen
  free(S.acc, ...(S.echo || []));
  S.acc = rt(W, H, SF32 ? gl.RGBA32F : gl.RGBA16F, FLIN || !SF32 ? gl.LINEAR : gl.NEAREST, Math.floor(Math.log2(Math.max(W, H))) + 1);
  const ew = Math.max(2, Math.round(W / 16)), eh = Math.max(2, Math.round(H / 16));
  S.echo = [0, 1].map(() => rt(ew, eh, FLIN ? gl.RGBA32F : gl.RGBA16F)); S.accFrames = 0;
}
function smokeIterate() { draw(stepProg, S.st[1 - S.si], { st: S.st[S.si] }, { P: S.cur }); S.si = 1 - S.si; }
function smokeBox(k) {   // the union over orbits from four corners (two attractors can coexist), smoothed
  let b = null;
  for (const s0 of [[1.5, 1.5], [-1.5, 1.5], [1.5, -1.5], [-1.5, -1.5]]) {
    const a = analyse(S.cur, 1500, s0); if (!b) b = a.box.slice(); else { b[0] = Math.min(b[0], a.box[0]); b[1] = Math.max(b[1], a.box[1]); b[2] = Math.min(b[2], a.box[2]); b[3] = Math.max(b[3], a.box[3]); }
  }
  if (!S.box) S.box = b.slice(); else for (let i = 0; i < 4; i++) S.box[i] = lerp(S.box[i], b[i], k);
}
// the display's slow turn, breathing zoom and drift (applied when the buffer is shown, so it never smears the smoke)
const smokeCam = (tS) => ({ ang: 0.22 * Math.sin(tS * 2 * Math.PI / 240) + 0.08 * Math.sin(tS * 2 * Math.PI / 97 + 1),
  zoom: 1 + 0.05 * Math.sin(tS * 2 * Math.PI / 170 + 2), pan: [0.012 * W * Math.sin(tS * 2 * Math.PI / 133), 0.012 * H * Math.cos(tS * 2 * Math.PI / 151) - stageShift()] });
function smokeStep(dt, show, C) {
  S.phase += dt;
  const HOLDF = set.hold * FPS, MORPHF = MORPH * FPS;
  smokeSearch();
  if (S.phase > HOLDF && !S.to) S.phase = HOLDF;   // the search is not done: the hold lasts until it is
  if (S.phase > HOLDF) {
    S.morphT = Math.min(1, (S.phase - HOLDF) / MORPHF);
    const s = smooth5(S.morphT); S.cur = S.from.map((v, i) => lerp(v, S.to[i], s));
    if (S.morphT >= 1) { S.from = S.to; S.to = null; S.search = pickNext(S.from); S.phase = 0; S.morphT = 0; switches++; themeStep(); }
  }
  smokeBox(1 - Math.exp(-dt / 20));
  const box = S.box, bw = box[1] - box[0], bh = box[3] - box[2];
  // fit: the box, rotated by up to the drift angle, inside 90% of the height and 82% of the width
  const amax = 0.3, cA = Math.cos(amax), sA = Math.sin(amax), rw = bw * cA + bh * sA, rh = bw * sA + bh * cA;
  const fitK = Math.min((W < H ? 0.9 : 0.82) * W / rw, 0.9 * stageH() / rh);
  const acc = S.acc, NPTS = SW * S.SH;
  const decay = Math.exp(-dt / (TAU * FPS));
  fade(acc, decay);
  const ctr = [(box[0] + box[1]) / 2, (box[2] + box[3]) / 2];
  S.fitK = fitK; S.ctr = ctr;
  for (let i = 0; i < ITERS; i++) {
    gl.disable(gl.BLEND); smokeIterate(); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, acc.fb); gl.viewport(0, 0, acc.w, acc.h); gl.useProgram(splatProg.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, S.st[S.si].t); gl.uniform1i(splatProg.u.st, 0);
    gl.uniform1i(splatProg.u.sw, SW); setU(splatProg, { ctr, k: [fitK * 2 / W, -fitK * 2 / H], C0: C.c[0], C1: C.c[1], C2: C.c[2] });
    gl.bindVertexArray(vao0); gl.drawArrays(gl.POINTS, 0, NPTS);
  }
  gl.disable(gl.BLEND);
  S.accFrames += dt;
  const echoOn = set.glow > 0;
  if (!show && !echoOn) return false;
  gl.bindTexture(gl.TEXTURE_2D, acc.t); gl.generateMipmap(gl.TEXTURE_2D);
  // exposure: steady total splats over the box's area in pixels, so a dense attractor and a loose one read alike
  const total = ITERS * NPTS * (1 - Math.pow(decay, S.accFrames)) / (1 - decay);
  const expo = 1 / (total / Math.max(1, bw * bh * fitK * fitK));
  const { ang, zoom, pan } = smokeCam(frames / FPS);
  if (echoOn) { const e0 = S.echo[S.ei], e1 = S.echo[1 - S.ei];
    draw(sEchoProg, e1, { acc, prev: e0 }, { res: [W, H], eres: [e1.w, e1.h], pan, ang, zoom, expo, lod: 4, k: 1 - Math.exp(-dt / (8 * FPS)) }); S.ei = 1 - S.ei; }
  if (!show) return false;
  draw(showProg, T.base, { acc, echo: S.echo[S.ei] }, { res: [W, H], pan, ang, zoom, expo, gain: 0.55, glowK: 0.35, lod: Math.log2(Math.max(W, H) / 120),
    t: (frames % 97) * 0.37, bgA: C.bg[0], bgB: C.bg[1], echoK: echoOn ? 60 : 0, echoPow: 0.5, echoLvl: 0.04 * set.glow / 50 });
  return true;
}

// ======================================================================================================================
// The screen: points into a float buffer with a short decay, bloom, the glow (an echo of the wide bloom), tonemap
const downProg = prog(FSV, `#version 300 es
precision highp float; uniform sampler2D src; uniform vec2 res, stx; out vec4 o;
void main(){ vec2 uv = gl_FragCoord.xy / res; vec3 c = texture(src, uv).rgb * 4.;
  c += texture(src, uv + vec2(-1, -1) * stx).rgb + texture(src, uv + vec2(1, -1) * stx).rgb + texture(src, uv + vec2(-1, 1) * stx).rgb + texture(src, uv + vec2(1, 1) * stx).rgb;
  o = vec4(c / 8., 1.); }`);
const upProg = prog(FSV, `#version 300 es
precision highp float; uniform sampler2D src, add; uniform vec2 res, stx; uniform float k; out vec4 o;
void main(){ vec2 uv = gl_FragCoord.xy / res; vec3 c = vec3(0);
  c += texture(src, uv + vec2(-2, 0) * stx).rgb + texture(src, uv + vec2(2, 0) * stx).rgb + texture(src, uv + vec2(0, -2) * stx).rgb + texture(src, uv + vec2(0, 2) * stx).rgb;
  c += (texture(src, uv + vec2(-1, -1) * stx).rgb + texture(src, uv + vec2(1, -1) * stx).rgb + texture(src, uv + vec2(-1, 1) * stx).rgb + texture(src, uv + vec2(1, 1) * stx).rgb) * 2.;
  o = vec4(c / 12. * k + texture(add, uv).rgb, 1.); }`);
const echoProg = prog(FSV, `#version 300 es
precision highp float; uniform sampler2D prev, src; uniform vec2 res; uniform float k; out vec4 o;
void main(){ vec2 uv = gl_FragCoord.xy / res; o = vec4(mix(texture(prev, uv).rgb, texture(src, uv).rgb, k), 1.); }`);
// Discovery and Classic: the sky is a gradient; Smoke: the sky is the smoke (already toned), and the dust is screened over it
const finalProg = prog(FSV, `#version 300 es
precision highp float; uniform sampler2D hdr, bloom, echo, base, nerd; uniform vec2 res, etx; uniform vec4 nerdRect; uniform float bloomK, echoK, echoPow, echoLvl, expo, t, useBase, nerdOn;
uniform vec3 bgA, bgB, echoTint; out vec4 o;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + t) * 43758.5453); }
void main(){ vec2 uv = gl_FragCoord.xy / res; vec3 c = texture(hdr, uv).rgb + texture(bloom, uv).rgb * bloomK;
  if (echoK > 0.) { vec3 e = vec3(0); for (int i = 0; i < 9; i++) { vec2 o2 = vec2(i % 3 - 1, i / 3 - 1); e += texture(echo, uv + o2 * etx * 1.5).rgb; }
    e /= 9.; float el = dot(e, vec3(.3, .5, .2)) + 1e-6;
    // lifted: the far, faint tail of the average is what reaches across the screen
    float lift = pow(el * echoK, echoPow) / el; c += mix(vec3(el), e, .6) * lift * echoTint * echoLvl; }
  c = 1. - exp(-c * expo);
  vec2 q = (gl_FragCoord.xy - res * .5) / max(res.x, res.y);
  vec3 bg = useBase > .5 ? texture(base, uv).rgb : mix(bgA, bgB, smoothstep(0., .8, length(q)));
  c = bg + c * (1. - bg);
  if (nerdOn > .5) { vec2 nu = (gl_FragCoord.xy - nerdRect.xy) / nerdRect.zw;   // Nerd mode's panel (premultiplied)
    if (nu.x >= 0. && nu.y >= 0. && nu.x <= 1. && nu.y <= 1.) { vec4 n = texture(nerd, nu); c = c * (1. - n.a) + n.rgb; } }
  c += (hash(gl_FragCoord.xy) - .5) / 255.; o = vec4(c, 1.); }`);
const ELV = 5;   // the glow averages this bloom level (1/64 res), which already holds the wider ones
let W = 0, H = 0, T = null;
function resize() {
  const dpr = still ? 1 : Math.min(devicePixelRatio || 1, 1.25);
  const w = still ? num('w', 1280) : Math.round(innerWidth * dpr), h = still ? num('h', 720) : Math.round(innerHeight * dpr);
  if (w === W && h === H) return; W = cv.width = w; H = cv.height = h;
  if (T) { free(T.hdr, T.base, ...T.echo); T.L.forEach((l) => free(...l)); }
  const L = []; let lw = W, lh = H; for (let i = 0; i < 7; i++) { lw = Math.max(1, Math.ceil(lw / 2)); lh = Math.max(1, Math.ceil(lh / 2)); L.push([rt(lw, lh), rt(lw, lh)]); }
  const e = L[ELV][0], EF = FLIN ? gl.RGBA32F : gl.RGBA16F;   // 32-bit where the GPU filters it, a precaution for the slow average
  T = { hdr: rt(W, H), base: rt(W, H, gl.RGBA8), L, echo: [rt(e.w, e.h, EF), rt(e.w, e.h, EF)], ei: 0 };
  if (S) smokeTargets();
  lastVP = null;
}

// ---- colour: a theme, or Cycling (the next theme with each new shape, crossfading through the morph) ----
let cycIdx = 0, colour = null;
function themeStep() { cycIdx = (cycIdx + 1) % THEME_ORDER.length; }
const morphWeight = () => (set.mode === 'smoke' ? (S ? smooth5(S.morphT) : 0) : morphW);
function themeTarget() {
  if (set.theme !== 'cycle') return THEMES[set.theme] || THEMES.coral;
  const a = THEMES[THEME_ORDER[cycIdx]], b = THEMES[THEME_ORDER[(cycIdx + 1) % THEME_ORDER.length]], w = morphWeight();
  return { c: [0, 1, 2].map((i) => mix3(a.c[i], b.c[i], w)), bg: [0, 1].map((i) => mix3(a.bg[i], b.bg[i], w)), dust: mix3(a.dust, b.dust, w) };
}
function updateColour(dt) {   // a picked theme fades in over ~2 s; Cycling already moves smoothly with the morph
  const tg = themeTarget();
  if (!colour) { colour = tg; return; }
  const k = set.theme === 'cycle' && !colourFading ? 1 : 1 - Math.exp(-dt / (0.7 * FPS));
  colour = { c: [0, 1, 2].map((i) => mix3(colour.c[i], tg.c[i], k)), bg: [0, 1].map((i) => mix3(colour.bg[i], tg.bg[i], k)), dust: mix3(colour.dust, tg.dust, k) };
  if (colourFading && Math.abs(colour.c[0][0] - tg.c[0][0]) + Math.abs(colour.c[2][2] - tg.c[2][2]) < 1e-3) colourFading = false;
}
let colourFading = false;

// ======================================================================================================================
// Nerd mode: the math on screen as the shapes change. Off by default; while off its
// per-frame work never runs and the frame is the same to the bit. On: a panel in the bottom-left corner (a 2D canvas redrawn
// 15 times a second and laid over the frame in the final pass) with the live equations, the mix during a morph, and the
// butterfly effect: two points 1e-6 apart, the log of their distance, and the Lyapunov exponent read from its slope. It
// draws nothing in the scene: the field's arrows were removed.
const rnd3 = mkRng(SEED ^ 0x2545f491);   // its own stream: Nerd mode never moves the particles' or Smoke's random numbers
const EQ = [   // each system's right-hand sides and constants, as text (the same as SYS and FIELD_GLSL)
  { r: ['−a·x − 4y − 4z − y²', '−a·y − 4z − 4x − z²', '−a·z − 4x − 4y − x²'], k: 'a = 1.4' },
  { r: ['(z − b)·x − d·y', 'd·x + (z − b)·y', 'c + a·z − z³/3 − (x² + y²)(1 + e·z) + f·z·x³'], k: 'a = 0.95  b = 0.7  c = 0.6  d = 3.5  e = 0.25  f = 0.1' },
  { r: ['sin y − b·x', 'sin z − b·y', 'sin x − b·z'], k: 'b = 0.208186' },
  { r: ['y − a·x + b·y·z', 'c·y − x·z + z', 'd·x·y − e·z'], k: 'a = 3  b = 2.7  c = 1.7  d = 2  e = 9' },
  { r: ['σ·(y − x)', 'x·(ρ − z) − y', 'x·y − β·z'], k: 'σ = 10  ρ = 28  β = 8/3' },
];
const LHS = ['dx/dt', 'dy/dt', 'dz/dt'];
// a shape's equations as text: a textbook system's as written; a found flow's its live coefficients, terms that are zero dropped, to 2 significant figures
const QTERM = ['', 'x', 'y', 'z', 'x²', 'y²', 'z²', 'x·y', 'x·z', 'y·z'];
function eqOf(Y) {
  if (Y.textbook) return { r: EQ[Y.fam].r, k: EQ[Y.fam].k };
  const r = [0, 1, 2].map((e) => { let out = '';
    for (let k = 0; k < 10; k++) { const v = Y.P[e * 10 + k]; if (v === 0) continue;
      const r = +Math.abs(v).toPrecision(2), m = r.toFixed(Math.max(0, 1 - Math.floor(Math.log10(r)))).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
      const a = m === '1' && k > 0 ? '' : m;   // 2 significant figures in decimals, never 1.6e+2 or 3e-7; 1·x is x
      out += (out ? (v < 0 ? ' − ' : ' + ') : v < 0 ? '−' : '') + a + QTERM[k]; }
    return out || '0'; });
  return { r, k: `a flow found from ${Y.base}; λ ${sig(Y.lamNat)} per unit of its time` };
}
const shName = (Y) => (Y.fam === 5 ? 'discovery ' + Y.n : Y.name);
const titleOf = (Y) => (Y.textbook ? `the ${Y.name} attractor` : `discovery ${Y.n}, a quadratic flow`);
const PAIR_S = 20, PAIR_D0 = 1e-6, LAM_N = 122000, LAM_SKIP = 2000;
const NERD = { on: false, cv: document.createElement('canvas'), tex: gl.createTexture(), rect: [0, 0, 1, 1], pair: null, sp: null,
  flung: 0, ms: 0, msMax: 0, panelMs: 0, panelMax: 0, texW: 0, texH: 0, lam: [null, null, null, null, null], job: [null, null, null, null, null], smokeLam: null, smokeLamAt: -1e9, lastPanel: -1 };
NERD.x = NERD.cv.getContext('2d');
gl.bindTexture(gl.TEXTURE_2D, NERD.tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

// the field on the CPU, the same as G in the shader: unit space, blended during a morph
function G1js(Y, u) {
  const p = [0, 1, 2].map((j) => Y.c[j] + Y.s * (Y.ex[j] * u[0] + Y.ey[j] * u[1] + Y.ez[j] * u[2]));
  const f = Y.f(p[0], p[1], p[2]), q = Y.k / Y.s; return [q * dot(Y.ex, f), q * dot(Y.ey, f), q * dot(Y.ez, f)];
}
const Gjs = (u) => (morphW > 0 ? mix3(G1js(curSh, u), G1js(nxtSh, u), morphW) : G1js(curSh, u));
// a shape's long-run exponent per unit of its native time: the textbook systems' measured here (lamWork), a searched shape's by its vet
const lamOf = (Y) => (Y.textbook ? NERD.lam[Y.fam] : Y.lamNat);
function rk4(g, u, h) {
  const k1 = g(u), k2 = g(u.map((x, j) => x + h / 2 * k1[j])), k3 = g(u.map((x, j) => x + h / 2 * k2[j])), k4 = g(u.map((x, j) => x + h * k3[j]));
  return u.map((x, j) => x + h / 6 * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
}
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// each system's long-run exponent (Benettin: one pair renormalised every step, 3600 s of its unit clock after 60 s let go,
// 400-8000 of its own time units), in the system's own time units; computed in slices of 300 steps a frame (about 13 s a
// system), the shown systems first, so turning Nerd mode on never stalls a frame
function lamWork() {
  const order = [curSh.fam, nxtSh.fam, 0, 1, 2, 3, 4].filter((i) => i < 5); let budget = 300;
  for (const i of order) {
    if (NERD.lam[i] !== null) continue;
    const g = (x) => G1js(SYS[i], x), d0 = 1e-7, h = 0.03;
    const seed = () => Array.from(SYS[i].seedData.subarray(0, 3));
    let J = NERD.job[i]; if (!J) { const u = seed(); J = NERD.job[i] = { u, v: [u[0] + d0, u[1], u[2]], L: 0, n: 0, m: 0 }; }
    while (budget > 0 && J.n < LAM_N) {
      J.u = rk4(g, J.u, h); J.v = rk4(g, J.v, h); const d = dist3(J.u, J.v); J.n++; budget--;
      if (!(d > 0 && d < 1e3) || !J.u.every(isFinite)) {   // no reading: a NaN, a zero or a runaway gap is not zero growth
        if (!J.u.every(isFinite)) J.u = seed(); J.v = [J.u[0] + d0, J.u[1], J.u[2]]; continue; }
      if (J.n > LAM_SKIP) { J.L += Math.log(d / d0); J.m++; }
      J.v = J.u.map((x, j) => x + (J.v[j] - x) * d0 / d);
    }
    if (J.n >= LAM_N) { NERD.lam[i] = J.m ? J.L / (J.m * h) / SYS[i].k : null; NERD.job[i] = null; if (NERD.lam[i] === null) NERD.lam[i] = NaN; }   // per unit clock, over k: per native time unit
    if (budget <= 0) return;
  }
}
// the least-squares slope of ln(distance) against time over the pair's growing stretch (10^-5.5 < d < 10^-1.5), once it spans 2.5 decades
function slope(log) {
  const pts = log.filter((e) => e.l > -5.5 && e.l < -1.5); if (pts.length < 8) return null;
  let lo = 0, hi = -9; for (const e of pts) { lo = Math.min(lo, e.l); hi = Math.max(hi, e.l); } if (hi - lo < 2.5) return null;   // too short a climb: the first moments, while the gap turns into the stretching direction, mislead
  let sx = 0, sy = 0, sxx = 0, sxy = 0; for (const e of pts) { sx += e.t; sy += e.l; sxx += e.t * e.t; sxy += e.t * e.l; }
  const n = pts.length, den = n * sxx - sx * sx; return den > 0 ? (n * sxy - sx * sy) / den * Math.LN10 : null;
}
// Discovery and Classic: the pair runs on its own clock, x N, so two points 1e-6 apart part in about 15 s (on the cloud's clock it takes
// 2 to 12 minutes, by the system); a new pair every 20 s. The log is against the system's own time, so its slope is lambda.
function pairStep(h) {
  let P = NERD.pair;
  if (morphW === 0) NERD.flung = 0;
  const out = P && !(Math.hypot(...P.a) <= 3 && Math.hypot(...P.b) <= 3);   // either point past radius 3, or blown up to NaN
  if (out) NERD.flung++;
  if (!P || P.s >= PAIR_S || out) {
    // from a point on the shape the field mostly is; one flung out of the blend mid-morph (the cloud's particles are reborn
    // too) is replaced, so the sparkline starts over
    const d = (morphW > 0.5 ? nxtSh : curSh).seedData, j = Math.floor(rnd3() * 4096) * 4, a = [d[j], d[j + 1], d[j + 2]];
    let r = [rnd3() - 0.5, rnd3() - 0.5, rnd3() - 0.5]; const m = Math.hypot(...r);
    P = NERD.pair = { a, b: a.map((x, k) => x + PAIR_D0 * r[k] / m), s: 0, tau: 0, log: [], ta: [], tb: [], clock: 1 };
  }
  const fin = (l) => (l !== null && isFinite(l) ? l : null);   // a system with no reading (NaN) counts as not yet measured
  const k = lerp(curSh.k, nxtSh.k, morphW), la = fin(lamOf(curSh)), lb = fin(lamOf(nxtSh));
  const lamA = la !== null ? la * curSh.k : null, lamB = lb !== null ? lb * nxtSh.k : null;   // on the unit clock
  const lamU = lamA !== null && lamB !== null ? lerp(lamA, lamB, morphW) : lamA !== null ? lamA : lamB !== null ? lamB : 0.06;   // whichever is known
  P.clock = Math.max(1, Math.min(60, Math.log(0.3 / PAIR_D0) / (15 * Math.max(lamU, 1e-3))));   // up to x60: Thomas needs about x48
  const span = h * P.clock, n = Math.max(1, Math.ceil(span / 0.02)), hu = span / n;
  for (let i = 0; i < n; i++) { P.a = rk4(Gjs, P.a, hu); P.b = rk4(Gjs, P.b, hu); P.ta.push(P.a); P.tb.push(P.b); }
  const keep = Math.ceil(1.2 * FPS * n); if (P.ta.length > keep) { P.ta.splice(0, P.ta.length - keep); P.tb.splice(0, P.tb.length - keep); }
  P.n = n; P.s += h; P.tau += span * k;   // the unit field runs k times the system's own clock
  P.log.push({ t: P.tau, s: P.s, l: Math.log10(Math.max(1e-12, dist3(P.a, P.b))) });
}
// Smoke: two points of the map 1e-6 apart, hopping a few times a second (sooner where the map is more chaotic), re-paired every 20 s
const cliff = (P0, p) => [Math.sin(P0[0] * p[1]) + P0[2] * Math.cos(P0[4] * p[0]), Math.sin(P0[1] * p[0]) + P0[3] * Math.cos(P0[5] * p[1])];
function smokePairStep(h) {
  if (simT - NERD.smokeLamAt > 0.5) { NERD.smokeLam = analyse(S.cur, 3000).lyap; NERD.smokeLamAt = simT; }
  let P = NERD.sp;
  if (!P || P.s >= PAIR_S) {
    let a = [rnd3() - 0.5, rnd3() - 0.5]; for (let i = 0; i < 300; i++) a = cliff(S.cur, a);
    const th = rnd3() * 6.2832; P = NERD.sp = { a, b: [a[0] + PAIR_D0 * Math.cos(th), a[1] + PAIR_D0 * Math.sin(th)], s: 0, n: 0, acc: 0, log: [], ha: [a], hb: [a] };
    P.rate = Math.max(2, Math.min(12, Math.log(0.3 / PAIR_D0) / (15 * Math.max(0.05, NERD.smokeLam))));
  }
  P.s += h; P.acc += P.rate * h;
  while (P.acc >= 1) {
    P.acc -= 1; P.a = cliff(S.cur, P.a); P.b = cliff(S.cur, P.b); P.n++;
    P.ha.push(P.a); P.hb.push(P.b); if (P.ha.length > 8) { P.ha.shift(); P.hb.shift(); }
    P.log.push({ t: P.n, s: P.s, l: Math.log10(Math.max(1e-12, Math.hypot(P.a[0] - P.b[0], P.a[1] - P.b[1]))) });
  }
}
// the panel: drawn on the canvas, uploaded, and laid over the frame in the final pass, bottom-left, clear of the taskbar
const fmt = (v, n) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(n);
const sig = (v) => (v < 0 ? '−' : '') + Math.abs(v).toPrecision(2);   // two significant figures: Thomas's 0.0079 is not 0.01
const SERIF = '"Cambria Math", "STIX Two Math", Cambria, "DejaVu Serif", Georgia, serif', SANS = '"Segoe UI", system-ui, "DejaVu Sans", sans-serif';
function panel(cam) {
  const U = Math.max(0.9, Math.min(W, H) / 1440), smoke = set.mode === 'smoke', x = NERD.x, cw = Math.round(640 * U), ch = Math.round(560 * U);
  if (NERD.cv.width !== cw || NERD.cv.height !== ch) { NERD.cv.width = cw; NERD.cv.height = ch; }
  x.clearRect(0, 0, cw, ch);
  const ink = (a) => `rgba(226, 232, 244, ${a.toFixed(3)})`, pad = 20 * U, lh = 23 * U, rows = [];
  let y = pad + 12 * U;
  const text = (s, px, font, a, dx) => rows.push({ s, y, font: `${(px * U).toFixed(1)}px ${font}`, a, dx: (dx || 0) * U });
  const label = (s) => { text(s.toUpperCase(), 11, SANS, 0.48); y += 21 * U; };
  let ins;
  if (!smoke) {
    const A = curSh, B = nxtSh, w = morphW, EA = eqOf(A), EB = eqOf(B);
    if (w > 0) {
      // what the code does (FIELD_GLSL's G): each system's field evaluated in its own frame, the two vectors mixed
      label(`nerd mode · morphing ${A.fam === 5 ? 'discovery ' + A.n : A.name} → ${B.fam === 5 ? 'discovery ' + B.n : B.name}`);
      text(`du/dt = (1 − s)·G_A(u) + s·G_B(u)      s = ${w.toFixed(3)}`, 15.5, SERIF, 0.64); y += lh;
      text('each G is its system in its own frame: G(u) = k·M·F(c + L·Mᵀu) / L, with F its equations below', 10.5, SANS, 0.34); y += 22 * U;
      for (const [Y, E, wt, nm] of [[A, EA, 1 - w, 'A'], [B, EB, w, 'B']]) {
        text(`${nm} = ${Y.fam === 5 ? 'discovery ' + Y.n : Y.name}, weight ${wt.toFixed(2)}:   ${E.k}`, 11.5, SERIF, 0.14 + 0.36 * wt); y += 19 * U;
        for (let i = 0; i < 3; i++) { text(`${LHS[i]} = ${E.r[i]}`, 13.5, SERIF, 0.14 + 0.5 * wt, 16); y += 19 * U; }
        y += 3 * U;
      }
    } else {
      label(`nerd mode · ${titleOf(A)}`);
      for (let i = 0; i < 3; i++) { text(`${LHS[i]} = ${EA.r[i]}`, 16, SERIF, 0.66); y += lh + 2 * U; }
      text(EA.k, 12.5, SERIF, 0.42); y += 19 * U;
    }
    if (w === 0) { text('drawn in its own frame, u = M(p − c) / L, its clock ×k; a morph mixes two such fields', 10.5, SANS, 0.3); y += 26 * U; } else y += 6 * U;
    const P = NERD.pair, la = lamOf(A), lb = lamOf(B), nmA = A.fam === 5 ? 'its' : A.name;
    if (w > 0 && NERD.flung > 0) { text(`${NERD.flung} pair${NERD.flung > 1 ? 's' : ''} thrown past radius 3 and replaced this morph`, 10.5, SANS, 0.36); y += 18 * U; }
    label(`butterfly effect · two points 10⁻⁶ apart · their clock ×${P ? P.clock.toFixed(1) : '…'}`);
    const lv = (l) => (l === null ? '…' : isFinite(l) ? sig(l) : '—');
    ins = { y, P, lm: P ? slope(P.log) : null,   // the blend's own long run is not measured: during a morph, the two ends
      long: w > 0 ? `long run: ${A.fam === 5 ? 'A' : A.name} ${lv(la)}, ${B.fam === 5 ? 'B' : B.name} ${lv(lb)}` : `λ = ${lv(la)}  long run, per unit of ${nmA} time` };
  } else {
    const P0 = S.cur;
    label('nerd mode · a Clifford map with six constants');
    text('x′ = sin(a·y) + c·cos(e·x)', 16, SERIF, 0.66); y += lh + 2 * U;
    text('y′ = sin(b·x) + d·cos(f·y)', 16, SERIF, 0.66); y += lh + 2 * U;
    text(`a = ${fmt(P0[0], 3)}    b = ${fmt(P0[1], 3)}    c = ${fmt(P0[2], 3)}`, 13.5, SERIF, 0.52); y += 20 * U;
    text(`d = ${fmt(P0[3], 3)}    e = ${fmt(P0[4], 3)}    f = ${fmt(P0[5], 3)}`, 13.5, SERIF, 0.52); y += 22 * U;
    text(S.morphT > 0 ? `the constants walk to the next shape: ${(smooth5(S.morphT) * 100).toFixed(0)}%` : 'every point jumps to (x′, y′), millions a frame; the smoke is where they land', 11, SANS, 0.36); y += 18 * U;
    text(`Lyapunov exponent of these constants: λ = ${NERD.smokeLam !== null ? fmt(NERD.smokeLam, 2) : '…'} per jump`, 12.5, SERIF, 0.46); y += 26 * U;
    const P = NERD.sp;
    label(`butterfly effect · two points 10⁻⁶ apart · ${P ? P.rate.toFixed(0) : '…'} jumps a second`);
    ins = { y, P, lm: P ? slope(P.log) : null, long: `λ = ${NERD.smokeLam !== null ? fmt(NERD.smokeLam, 2) : '…'}  long run, per jump` };
  }
  const iw = 220 * U, ih = 150 * U, iy = ins.y, hh = iy + ih + 34 * U;
  x.save(); x.translate(0, H > W ? 0 : ch - hh);   // the content sits on the panel's edge nearest the screen's
  x.fillStyle = 'rgba(4, 6, 12, 0.32)'; x.beginPath(); if (x.roundRect) x.roundRect(0, 0, cw, hh, 14 * U); else x.rect(0, 0, cw, hh); x.fill();
  x.textBaseline = 'alphabetic';
  for (const t of rows) { x.font = t.font; x.fillStyle = ink(t.a); x.fillText(t.s, pad + t.dx, t.y, cw - 2 * pad - t.dx); }   // a long line (a found flow's) is narrowed, never clipped
  // the inset: the pair (amber, cyan) over a faint ghost of the shape
  const ix = pad, P = ins.P;
  x.strokeStyle = ink(0.12); x.lineWidth = 1; x.strokeRect(ix, iy, iw, ih);
  x.save(); x.beginPath(); x.rect(ix, iy, iw, ih); x.clip();
  if (!smoke) {
    const sc = Math.min(iw, ih) * 0.6 / Math.min(W, H), cx = ix + iw / 2, cy = iy + ih / 2, v = cam.vpRaw;
    const proj = (u) => { const X = v[0] * u[0] + v[4] * u[1] + v[8] * u[2] + v[12], Y = v[1] * u[0] + v[5] * u[1] + v[9] * u[2] + v[13], Wc = v[3] * u[0] + v[7] * u[1] + v[11] * u[2] + v[15];
      return [cx + X / Wc * W * sc, cy - Y / Wc * H * sc]; };
    for (const [Y, a] of [[curSh, 1 - morphW], [nxtSh, morphW]]) { if (a < 0.02 || (Y === curSh && a < 1 && curSh === nxtSh)) continue;
      x.fillStyle = ink(0.24 * a); const d = Y.seedData; for (let k = 0; k < 4096; k += 5) { const qp = proj([d[k * 4], d[k * 4 + 1], d[k * 4 + 2]]); x.fillRect(qp[0], qp[1], U, U); } }
    if (P) for (const [tr, c] of [[P.ta, '255, 196, 107'], [P.tb, '107, 236, 255']]) {
      x.beginPath(); tr.forEach((u, k) => { const qp = proj(u); if (k) x.lineTo(qp[0], qp[1]); else x.moveTo(qp[0], qp[1]); });
      x.strokeStyle = `rgba(${c}, 0.75)`; x.lineWidth = 1.2 * U; x.stroke();
      const qp = proj(tr[tr.length - 1]); x.fillStyle = `rgb(${c})`; x.beginPath(); x.arc(qp[0], qp[1], 2.6 * U, 0, 6.2832); x.fill();
    }
  } else {
    const b = S.box, sc = Math.min(iw / (b[1] - b[0]), ih / (b[3] - b[2])) * 0.92, mx = (b[0] + b[1]) / 2, my = (b[2] + b[3]) / 2;
    const toM = (p) => [ix + iw / 2 + (p[0] - mx) * sc, iy + ih / 2 + (p[1] - my) * sc];   // y as on screen (the splat flips it)
    let qp = [0.1, -0.2]; x.fillStyle = ink(0.22);
    for (let k = 0; k < 2500; k++) { qp = cliff(S.cur, qp); if (k > 50) { const m = toM(qp); x.fillRect(m[0], m[1], U, U); } }
    if (P) for (const [hs, c] of [[P.ha, '255, 196, 107'], [P.hb, '107, 236, 255']]) {
      x.beginPath(); hs.forEach((p, k) => { const m = toM(p); if (k) x.lineTo(m[0], m[1]); else x.moveTo(m[0], m[1]); }); x.strokeStyle = `rgba(${c}, 0.3)`; x.lineWidth = U; x.stroke();
      hs.forEach((p, k) => { const m = toM(p), f = (k + 1) / hs.length; x.fillStyle = `rgba(${c}, ${(0.2 + 0.8 * f).toFixed(2)})`; x.beginPath(); x.arc(m[0], m[1], (1.2 + 1.8 * f) * U, 0, 6.2832); x.fill(); });
    }
  }
  x.restore();
  // the sparkline: log10 of the distance; while the two part it climbs in a straight line, and its slope is lambda
  const sx0 = ix + iw + 20 * U, sw = cw - sx0 - pad, sy0 = iy, shh = ih - 30 * U, ly = (l) => sy0 + shh * (1 - (Math.max(-6.5, Math.min(0.5, l)) + 6.5) / 7);
  x.strokeStyle = ink(0.12); x.lineWidth = 1; x.strokeRect(sx0, sy0, sw, shh);
  x.font = `${(10.5 * U).toFixed(1)}px ${SANS}`;
  for (const gg of [-6, -4, -2, 0]) { x.fillStyle = ink(0.07); x.fillRect(sx0, ly(gg), sw, 1); x.fillStyle = ink(0.3); x.fillText(gg ? '10' + ['⁻⁶', '', '⁻⁴', '', '⁻²'][gg + 6] : '1', sx0 + 4 * U, ly(gg) - 3 * U); }
  x.fillStyle = ink(0.3); x.fillText('distance (log)', sx0 + sw - 74 * U, sy0 + shh - 5 * U);
  if (P && P.log.length > 1) {
    x.beginPath(); P.log.forEach((e, k) => { const px = sx0 + sw * Math.min(1, e.s / PAIR_S), py = ly(e.l); if (k) x.lineTo(px, py); else x.moveTo(px, py); });
    x.strokeStyle = ink(0.78); x.lineWidth = 1.4 * U; x.stroke();
  }
  x.font = `${(13 * U).toFixed(1)}px ${SERIF}`; x.fillStyle = ink(0.66);
  x.fillText(`λ = ${ins.lm !== null ? sig(ins.lm) : '…'}  this pair`, sx0, sy0 + shh + 19 * U);
  x.font = `${(11.5 * U).toFixed(1)}px ${SERIF}`; x.fillStyle = ink(0.4);
  x.fillText(ins.long, sx0, sy0 + shh + 36 * U);
  x.restore();
  gl.bindTexture(gl.TEXTURE_2D, NERD.tex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  // the panel changes every redraw while a pair runs, so it is always uploaded; into the same storage while the size holds
  if (NERD.texW === cw && NERD.texH === ch) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, NERD.cv);
  else { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, NERD.cv); NERD.texW = cw; NERD.texH = ch; }
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  // landscape: bottom-left, clear of the taskbar; portrait: top-left, where the sky is empty (the art sits low and wide)
  NERD.rect = [Math.round(40 * U), H > W ? H - ch - Math.round(40 * U) : 48 + Math.round(28 * U), cw, ch];
  const top = H - NERD.rect[1] - ch + (H > W ? 0 : ch - hh); NERD.box = [NERD.rect[0], Math.round(top), NERD.rect[0] + cw, Math.round(top + hh)];   // the backing, from the screen's top
}
// one frame of Nerd mode's own state (after the simulation, before the scene's light buffer is bloomed)
function nerdFrame(h, show, cam) {
  const t0 = performance.now();
  lamWork();
  if (set.mode === 'smoke') { if (S) smokePairStep(h); } else pairStep(h);
  let pm = 0;
  if (show && (still || ticks - NERD.lastPanel >= 2)) { const t1 = performance.now(); panel(cam); NERD.lastPanel = ticks; pm = performance.now() - t1;
    NERD.panelMs = NERD.panelMs * 0.9 + pm * 0.1; NERD.panelMax = Math.max(NERD.panelMax, pm); }
  const ms = performance.now() - t0; NERD.ms = NERD.ms * 0.95 + ms * 0.05; NERD.msMax = Math.max(NERD.msMax, ms);   // CPU: the GPU timer does not see it
}
function setNerd(on) {
  if (on === NERD.on) return;
  const was = staged();
  NERD.on = on; NERD.pair = null; NERD.sp = null; NERD.lastPanel = -1;
  if (staged() !== was) lastVP = null;   // the stage moves (portrait): no streak across it. Elsewhere the scene is untouched
}
// Nerd mode in portrait (nothing may overlap at 1080x1920): the panel takes a band across
// the top, and the scene is staged in the rest. Particles move down (a shift in clip space, so the camera and its fit are
// unchanged); Smoke moves down and fits the band's height. Off, or in landscape, the stage is the screen: nothing changes.
function nerdBand() {   // the panel's band from the screen's top, in pixels (its canvas, its margin, and a gap)
  const U = Math.max(0.9, Math.min(W, H) / 1440); return Math.round(40 * U) + Math.round(560 * U) + Math.round(24 * U);
}
const STAGE_FOOT = 48 + 24;   // the taskbar and a gap
// staged only where the band leaves at least 40% of the screen below it: a portrait window shorter than about 1057 px (at
// U 0.9) keeps the scene where it is, under the panel, rather than squeezing it to nothing
const staged = () => NERD.on && H > W && H - STAGE_FOOT - nerdBand() >= 0.4 * H;
function stageShift() { return staged() ? (nerdBand() + H - STAGE_FOOT) / 2 - H / 2 : 0; }   // pixels down
function stageH() { return staged() ? H - STAGE_FOOT - nerdBand() : H; }

// ======================================================================================================================
let simT = 0, frames = 0, fpsE = 30, gpuE = NaN, lastPt = null;
// the shaders' time, wrapped: float32 time coarsens past a frame after about 6 days. The period is 8 cycles of the dust's
// ABC flow (its phases t·0.03 and t·0.051 share 2094.4 s), so the flow never jumps; once in 4.65 h the dust's seek cycles
// and the twinkle re-phase in one frame. The first 4.65 h are what they were (the sketch's frames, bit for bit).
const TWRAP = 8 * 2 * Math.PI * 10 / 0.03, shaderT = () => simT % TWRAP;
function frame(dt, show) {
  frames += dt; const h = dt / FPS; simT += h;
  updateColour(dt);
  const C = colour, smoke = set.mode === 'smoke';
  if (!endless()) { curSh = SYS[curId]; nxtSh = SYS[nextId]; } else searchStep();
  let baseReady = false;
  if (smoke) {
    baseReady = smokeStep(dt, show, C);
    simulate(h, true);
  } else {
    const ph = schedule();
    simulate(h, false);
    if (ph >= set.hold + BLEND) endMorph();
  }
  // points into the HDR buffer (a short decay: the faintest motion streak); Smoke draws the dust rows only
  const cam = camera(simT), VPp = lastVP || cam.vp; lastVP = cam.vp;
  const dec = Math.exp(-dt / (0.035 * FPS));
  fade(T.hdr, dec);
  const dustGain = 0.6 * set.dust / 50, first = smoke ? PW * NC * STRK : 0, count = (smoke ? PW * ND : set.dust > 0 ? NP : PW * NC) * STRK;
  if (count > 0 && !(smoke && set.dust <= 0)) {
    gl.useProgram(ptProg.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ps[pi].a); gl.uniform1i(ptProg.u.SA, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ps[pi].b); gl.uniform1i(ptProg.u.SB, 1);
    const ptU = { VP: cam.vp, pxScale: 1.3 * H / 1440 * Math.max(1, (H > W ? W / H * 1.5 : 1)),
      t: shaderT(), nc: NC, gain: (NOCORE ? 0 : 1) * 0.3 * (1 - dec) / (1 - Math.exp(-1 / (0.09 * FPS))) * (262144 / (PW * NC)),
      dustGain, focus: cam.dist, bokeh: 9, nearFade: 0.6, cSlow: C.c[0], cMid: C.c[1], cFast: C.c[2], dustTint: C.dust, strk: STRK, fdt: h, VPp, res: [W, H] };
    setU(ptProg, ptU); lastPt = { u: ptU, dec };
    gl.bindVertexArray(vao0); gl.drawArrays(gl.POINTS, first, count);
  }
  if (NERD.on) nerdFrame(h, show, cam);
  gl.disable(gl.BLEND);
  // the glow is a time average, so it (and the bloom chain it reads) runs every frame, shown or not
  const glowOn = !smoke && set.glow > 0;
  if (!show && !glowOn) return;
  let srcT = T.hdr;
  for (let i = 0; i < T.L.length; i++) { const d = T.L[i][0]; draw(downProg, d, { src: srcT }, { res: [d.w, d.h], stx: [1 / srcT.w, 1 / srcT.h] }); srcT = d; }
  for (let i = T.L.length - 2; i >= 0; i--) { const lo = i === T.L.length - 2 ? T.L[i + 1][0] : T.L[i + 1][1], d = T.L[i][1];
    draw(upProg, d, { src: lo, add: T.L[i][0] }, { res: [d.w, d.h], stx: [1 / lo.w, 1 / lo.h], k: 1 }); }
  if (glowOn) { const e0 = T.echo[T.ei], e1 = T.echo[1 - T.ei];
    draw(echoProg, e1, { prev: e0, src: T.L[ELV][1] }, { res: [e1.w, e1.h], k: 1 - Math.exp(-dt / (6 * FPS)) }); T.ei = 1 - T.ei; }
  if (!show) return;
  const e = T.echo[T.ei];
  draw(finalProg, null, { hdr: T.hdr, bloom: T.L[0][1], echo: e, base: T.base, nerd: NERD.tex }, { nerdOn: NERD.on && !NOPANEL ? 1 : 0, nerdRect: NERD.rect, res: [W, H], etx: [1 / e.w, 1 / e.h], bloomK: 0.22, echoK: glowOn ? 40 : 0,
    echoPow: 0.5, echoLvl: 0.1 * set.glow / 50, expo: 1, t: (frames % 97) * 0.37, bgA: C.bg[0], bgB: C.bg[1], echoTint: [0.85, 0.9, 1.05], useBase: smoke && baseReady ? 1 : 0 });
}

// ---- Wallpaper Engine properties: each acts only on a changed value (WE sends them all at start, and resends) ----
function clearGlow() {   // both glows' averages: one switched back on starts from nothing, never from a stale average
  for (const r of [...(T ? T.echo : []), ...(S ? S.echo : [])]) { gl.bindFramebuffer(gl.FRAMEBUFFER, r.fb); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
}
// the search's shapes go when nothing shows them: a textbook system stays (its texture is the page's)
function dropShapes() { if (SRCH.found && SRCH.found !== curSh && SRCH.found !== nxtSh) freeShape(SRCH.found); SRCH.found = null; SRCH.gen = null; }
function toTextbook() {   // the shapes on screen become a textbook system: the one on screen, or, for a found flow, an opening draw
  if (curId === 5) curId = firstSystem();
  if (nxtSh !== curSh) freeShape(nxtSh); freeShape(curSh); curSh = nxtSh = SYS[curId]; nextId = nextOf(curId);
}
// the mode: Discovery (found flows), Classic (the five textbook systems) or Smoke. A saved value from before the three
// modes maps: particles (the found flows by then) is Discovery
function setMode(m) {
  if (m === 'particles') m = 'discovery';
  if (m !== 'discovery' && m !== 'classic' && m !== 'smoke') return;
  if (m === set.mode) return;
  const was = set.mode;
  set.mode = m; NERD.pair = null; NERD.sp = null;
  if (m === 'smoke') { dropShapes(); morphW = 0; toTextbook(); smokeStart(); clearGlow(); }
  else if (was === 'smoke') {
    smokeStop(); phT0 = simT; morphW = 0; nextId = nextOf(curId); curSh = nxtSh = SYS[curId];
    if (endless()) startSearch(); else nxtSh = SYS[nextId];
    initParticles(NC);
  } else if (m === 'classic') {
    dropShapes();
    if (curSh.textbook && nxtSh.textbook) {   // a classic on screen (and, mid-morph, as the target): it stays, Classic goes on from it
      if (nxtSh === curSh) { nextId = nextOf(curId); nxtSh = SYS[nextId]; } else nextId = nxtSh.fam;
      return;
    }
    morphW = 0; toTextbook(); phT0 = simT; initParticles(NC);   // a found flow is not a classic: a cut
  } else if (morphW === 0) { nxtSh = curSh; startSearch(); return; }   // Classic to Discovery: the shape stays; mid-morph, endMorph starts the search
  else return;
  lastVP = null;   // the particles were re-seeded: no streak from the frame before
}
function setHold(v) {
  v = Math.max(5, Math.min(600, v)); if (v === set.hold) return;
  const old = set.hold;
  // keep the morph weight continuous: inside a morph its progress stays; inside a hold, a shorter hold starts a morph from 0
  const ph = simT - phT0;
  if (ph >= old) phT0 -= v - old; else phT0 = simT - Math.min(ph, v);
  if (S) { const pf = S.phase, of = old * FPS, nf = v * FPS; if (pf > of) S.phase = pf + nf - of; else S.phase = Math.min(pf, nf); }
  set.hold = v;
}
const prop = (props, k) => (props[k] && props[k].value !== undefined ? props[k].value : undefined);
function applyProps(props) {
  const v = (k) => prop(props, k);
  if (v('quality') !== undefined && QUALITY[v('quality')] && v('quality') !== set.quality) {
    set.quality = String(v('quality')); allocParticles(); if (S) smokePoints();
  }
  if (v('mode') !== undefined) setMode(String(v('mode')));
  if (v('theme') !== undefined && (THEMES[v('theme')] || v('theme') === 'cycle') && v('theme') !== set.theme) {
    if (v('theme') === 'cycle' && THEME_ORDER.includes(set.theme)) cycIdx = THEME_ORDER.indexOf(set.theme);   // Cycling starts from the theme on screen
    set.theme = String(v('theme')); colourFading = true;
  }
  if (v('dust') !== undefined && isFinite(+v('dust'))) set.dust = Math.max(0, Math.min(100, +v('dust')));
  if (v('glow') !== undefined && isFinite(+v('glow'))) { const g = Math.max(0, Math.min(100, +v('glow'))); if (g > 0 && set.glow === 0) clearGlow(); set.glow = g; }
  if (v('hold') !== undefined && isFinite(+v('hold'))) setHold(+v('hold'));
  if (v('nerd') !== undefined) setNerd(v('nerd') === true || v('nerd') === 'true' || v('nerd') === 1);
}
function firstSystem() { return RANDOM_START ? ALL[Math.floor(rnd4() * ALL.length)] : 0; }
window.wallpaperPropertyListener = window.wallpaperPropertyListener || {};
window.wallpaperPropertyListener.applyUserProperties = (props) => { try { applyProps(props); } catch (e) { console.error(e); } };
let paused = false, last = 0;
window.wallpaperPropertyListener.setPaused = (p) => { paused = !!p; last = 0; };
document.addEventListener('visibilitychange', () => { paused = document.hidden; last = 0; });
// a lost GPU context (driver reset, sleep) takes every buffer with it; the page starts over once it is back
cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); paused = true; });
cv.addEventListener('webglcontextrestored', () => location.reload());

// ---- HUD (key d), GPU timer ----
function status() {
  const smoke = set.mode === 'smoke';
  return `Phase Space   ${W}x${H}   ${set.mode}   quality ${set.quality}   theme ${set.theme}${set.theme === 'cycle' ? ' (' + THEME_ORDER[cycIdx] + ')' : ''}
fps ${fpsE.toFixed(1)}   gpu ${isNaN(gpuE) ? 'n/a' : gpuE.toFixed(2) + ' ms'}   t ${simT.toFixed(0)} s
dust ${set.dust}   glow ${set.glow}   hold ${set.hold} s   ${smoke ? (S && S.morphT > 0 ? 'morph ' + (S.morphT * 100).toFixed(0) + '%' : 'hold') : shName(curSh) + (morphW > 0 ? ' > ' + shName(nxtSh) + ' ' + (morphW * 100).toFixed(0) + '%' : '   next ' + shName(nxtSh))}
${smoke ? (SW * (S ? S.SH : 0) * ITERS / 1e6).toFixed(1) + 'M splats + ' + PW * ND + ' dust' : PW * NC + ' core + ' + PW * ND + ' dust'}`;
}
const pend = [], gpuSamples = [];
const tBegin = () => { if (!tq || pend.length > (still ? 80 : 4)) return null; const qq = gl.createQuery(); gl.beginQuery(tq.TIME_ELAPSED_EXT, qq); return qq; };
const tEnd = (qq) => { if (qq) { gl.endQuery(tq.TIME_ELAPSED_EXT); pend.push(qq); } };
function tPoll() {
  while (pend.length) {
    const qq = pend[0]; if (!gl.getQueryParameter(qq, gl.QUERY_RESULT_AVAILABLE)) break;
    const dis = gl.getParameter(tq.GPU_DISJOINT_EXT), ms = gl.getQueryParameter(qq, gl.QUERY_RESULT) / 1e6; pend.shift(); gl.deleteQuery(qq);
    if (!dis) { gpuE = isNaN(gpuE) ? ms : gpuE * 0.9 + ms * 0.1; gpuSamples.push(ms); }
  }
}
let hudOn = false, lastHud = 0;
addEventListener('keydown', (e) => { if (e.key === 'd' || e.key === 'D') { hudOn = !hudOn; hudEl.style.display = hudOn ? 'block' : 'none'; if (hudOn) hudEl.textContent = status(); } });

// ---- the loop: 30 fps, nothing while paused or hidden ----
let gapMax = 0, ticks = 0;
function tick(tt) {
  requestAnimationFrame(tick);
  if (paused || tt - last < 1000 / FPS - 2) return;
  const dt = last ? Math.min((tt - last) / (1000 / FPS), 3) : 1;
  if (last) { fpsE = fpsE * 0.92 + 0.08 * 1000 / (tt - last); gapMax = Math.max(gapMax, tt - last); }
  last = tt; ticks++; resize(); tPoll(); const qq = tBegin(); frame(dt, true); tEnd(qq);
  if (LIVETEST && wantRead) { wantRead(); wantRead = null; }
  if (hudOn && tt - lastHud > 400) { hudEl.textContent = status(); lastHud = tt; }
}

// ======================================================================================================================
// Dev aids, never set by Wallpaper Engine. Property values in both take WE's form or a plain value.
const wrap = (o) => { const r = {}; for (const k in o) r[k] = (o[k] !== null && typeof o[k] === 'object' && 'value' in o[k]) ? o[k] : { value: o[k] }; return r; };
const state = () => ({ mode: set.mode, theme: set.theme, dust: set.dust, glow: set.glow, hold: set.hold, quality: set.quality,
  nc: NC, nd: ND, smokeSH: S ? S.SH : 0, system: shName(curSh), next: shName(nxtSh), morph: +morphWeight().toFixed(3), cyc: THEME_ORDER[cycIdx], switches, searchMs: +searchMs.toFixed(2), searching: S ? !!S.search : null, phaseS: S ? +(S.phase / FPS).toFixed(2) : null,
  heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1e6).toFixed(1) : null,
  nerd: NERD.on, ...(NERD.on ? nerdState() : {}), ...(endless() ? endlessState() : {}) });
// the endless shapes: the shape on screen (family, coefficients, its vet's measures), the search, the textures held
const endlessState = () => ({ restarts: SRCH.restarts, searchingE: !!SRCH.gen, foundE: !!SRCH.found, took: SRCH.took === undefined ? null : +SRCH.took.toFixed(2),
  fam: curSh.fam, P: Array.from(curSh.P, (v) => +v.toPrecision(4)), vetM: curSh.m || null, liveTex, discoveries, tally: TALLY, slowSearch });
const nerdState = () => { const P = set.mode === 'smoke' ? NERD.sp : NERD.pair, lm = P ? slope(P.log) : null;
  return { pairS: P ? +P.s.toFixed(2) : null, pairLog10: P && P.log.length ? +P.log[P.log.length - 1].l.toFixed(2) : null, lamPair: lm === null ? null : +lm.toFixed(4),
    lamLong: NERD.lam.map((l) => (l === null ? null : +l.toFixed(4))), smokeLam: NERD.smokeLam === null ? null : +NERD.smokeLam.toFixed(4), clock: P && P.clock ? +P.clock.toFixed(2) : null, flung: NERD.flung, nerdMs: +NERD.ms.toFixed(2), nerdMsMax: +NERD.msMax.toFixed(2), panelMs: +NERD.panelMs.toFixed(2), panelMsMax: +NERD.panelMax.toFixed(2), panelBox: NERD.box || null, rate: P && P.rate ? +P.rate.toFixed(2) : null }; };
function readScreen() {   // mean luma, mean RGB, and the share of pixels not near-black (luma > 16), of the frame just drawn
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let sum = 0, filled = 0; const rgb = [0, 0, 0];
  for (let i = 0; i < px.length; i += 4) { const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; sum += l; if (l > 16) filled++; rgb[0] += px[i]; rgb[1] += px[i + 1]; rgb[2] += px[i + 2]; }
  const n = W * H; return { px, mean: +(sum / n).toFixed(2), filled: +(filled / n).toFixed(4), rgb: rgb.map((x) => +(x / n).toFixed(2)) };
}
// capture mode (?shots=f1,f2&w=&h=[&props={json}][&script=[[frame,{json}],...]]): fixed steps, frames read back in the page
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// the attractor's own light in a particle-mode frame: its core particles drawn alone, with the frame's own uniforms, into a
// scratch buffer, scaled to the buffer's steady state, toned and averaged as luma (0-255). The smoke set's check that the
// sculpture is there (the dust and glow alone carry a frame's mean past any floor). ?nocore=1 (capture only) draws the
// frame with the core's light at zero: the negative control.
const NOCORE = still && q.has('nocore');
const NOPANEL = still && q.has('nopanel');   // capture only: Nerd mode without its panel laid over, to measure what lies under it
let coreRT = null;
function coreLight() {
  if (set.mode === 'smoke' || !lastPt) return null;
  if (!coreRT || coreRT.w !== W || coreRT.h !== H) { free(coreRT); coreRT = rt(W, H, gl.RGBA32F, gl.NEAREST); }
  gl.bindFramebuffer(gl.FRAMEBUFFER, coreRT.fb); gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.useProgram(ptProg.p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ps[pi].a); gl.uniform1i(ptProg.u.SA, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ps[pi].b); gl.uniform1i(ptProg.u.SB, 1);
  setU(ptProg, lastPt.u); gl.bindVertexArray(vao0); gl.drawArrays(gl.POINTS, 0, PW * NC * STRK); gl.disable(gl.BLEND);
  const px = new Float32Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, px);
  const k = 1 / (1 - lastPt.dec); let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += 0.2126 * (1 - Math.exp(-px[i] * k)) + 0.7152 * (1 - Math.exp(-px[i + 1] * k)) + 0.0722 * (1 - Math.exp(-px[i + 2] * k));
  return +(255 * sum / (W * H)).toFixed(2);
}
async function runStill() {
  const out = [], maxF = Math.max(...SHOTS), every = num('stat', 0), script = JSON.parse(q.get('script') || '[]'); let f = 0;
  while (f < maxF) {
    f++;
    for (const [sf, p] of script) if (sf === f) applyProps(wrap(p));
    const s1 = SHOTS.includes(f), s2 = every && f % every === 0;
    frame(1, s1 || s2);
    if (s1 || s2) {
      const r = readScreen(), rec = { f, mean: r.mean, filled: r.filled, rgb: r.rgb, core: coreLight(), ...state() };
      if (s1) {
        const c2 = document.createElement('canvas'); c2.width = W; c2.height = H; const x2 = c2.getContext('2d'), im = x2.createImageData(W, H);
        for (let y = 0; y < H; y++) im.data.set(r.px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
        x2.putImageData(im, 0, 0);
        const pre = document.createElement('pre'); pre.id = 'f' + f; pre.hidden = true; pre.textContent = c2.toDataURL('image/png'); document.body.appendChild(pre);
      }
      out.push(rec);
    }
    if (f % 100 === 0) await sleep(0);
  }
  for (let i = 0; i < 60; i++) { const qq = tBegin(); frame(1, true); tEnd(qq); await sleep(20); tPoll(); }
  for (let i = 0; i < 50 && pend.length; i++) { await sleep(20); tPoll(); }
  const g = gpuSamples.slice().sort((a, b) => a - b), dbg = gl.getExtension('WEBGL_debug_renderer_info');
  document.title = 'ready ' + JSON.stringify({ W, H, renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?', shots: out,
    gpuMs: g.length ? { n: g.length, p50: +g[g.length >> 1].toFixed(2), p90: +g[Math.floor(g.length * 0.9)].toFixed(2) } : null });
}
// live test (?livetest=1&steps=[{at:ms, props?, pause?, hidden?}, ...]): real time; after each step's settle the page records
// the frames drawn, the fps, the state and the screen; a reader script judges
let wantRead = null;
async function runLive() {
  const steps = JSON.parse(q.get('steps') || '[]'), rec = []; const t0 = performance.now();
  let hidden = false; Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  for (const s of steps) {
    while (performance.now() - t0 < s.at) await sleep(20);
    const before = ticks; gapMax = 0;
    if (s.props) window.wallpaperPropertyListener.applyUserProperties(wrap(s.props));
    if (s.pause !== undefined) window.wallpaperPropertyListener.setPaused(!!s.pause);
    if (s.hidden !== undefined) { hidden = !!s.hidden; document.dispatchEvent(new Event('visibilitychange')); }
    await sleep(s.settle || 1500);
    const ticked = ticks - before, gap = gapMax;
    const r = paused ? null : await new Promise((res) => { wantRead = () => res(readScreen()); });
    rec.push({ step: s.name || '', ticked, gapMax: +gap.toFixed(1), fps: +fpsE.toFixed(1), mean: r ? r.mean : null, rgb: r ? r.rgb : null, filled: r ? r.filled : null, ...state() });
  }
  document.title = 'ready ' + JSON.stringify({ W, H, rec });
}

// ---- start ----
curId = firstSystem(); nextId = nextOf(curId); curSh = SYS[curId]; nxtSh = endless() ? curSh : SYS[nextId]; allocParticles();
if (endless()) startSearch();
resize();
if (q.has('props')) applyProps(wrap(JSON.parse(q.get('props'))));
// capture only (contact sheets): ?shape=5|P,...|p0,...|dt shows that one candidate (a quadratic flow, 30 coefficients) for the whole run. Its verdict is the
// search's (a dump of the search, in node); here the vet runs with its checks open, for the frame and the orbit points only
// (a re-vet would draw other random points, and a shape at the edge of a check could fail here and pass there)
if (still && q.has('shape')) {
  const [, ps, p0s, dts] = q.get('shape').split('|'), P = ps.split(',').map(Number);
  const cand = { fam: 5, P, p0: p0s.split(',').map(Number), dt: +dts, f: quadF(P), name: 'Explorer', base: q.get('base') || 'sheet' };
  const keep = Object.assign({}, VET); Object.assign(VET, { lamT: -1e9, dky: 1e9, med: 0, a2: 0, a3: 0, cov: 0, stiff: 1e9, maxSteps: 1e9, formOnly: true });
  const o = {}, g = vet(cand, o, null); while (!g.next().done); Object.assign(VET, keep);
  if (!o.pts) throw new Error('no orbit to draw: ' + o.why);
  SRCH.gen = null; SRCH.found = null; curSh = nxtSh = makeShape(cand, o); initParticles(PH);
}
if (still) runStill().catch((e) => { document.title = 'error ' + e.message; });
else {
  requestAnimationFrame(tick);
  if (LIVETEST) {
    if (q.has('hold')) { const im = new Image(); im.src = q.get('hold'); im.style.display = 'none'; document.body.appendChild(im); }   // holds the load event, so --dump-dom waits in real time
    runLive().catch((e) => { document.title = 'error ' + e.message; });
  }
}
})();
