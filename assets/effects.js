/* 仅在指针移动时绘制；停止后约 600ms 归零，不常驻动画循环。 */
(function () {
  'use strict';
  const canvas = document.getElementById('cursorTrail'), ctx = canvas.getContext('2d');
  if (!ctx) return;
  const fine = matchMedia('(pointer:fine)'), reduce = matchMedia('(prefers-reduced-motion:reduce)');
  let points = [], frame = 0, last = 0, width = 0, height = 0, ratio = 1;
  const enabled = () => fine.matches && !reduce.matches && !document.hidden && document.documentElement.dataset.motion === 'on' && document.documentElement.dataset.trail === 'on' && !document.querySelector('dialog[open]') && !(navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4) && !navigator.connection?.saveData;
  function resize() { ratio = Math.min(devicePixelRatio || 1, 1.5); width = innerWidth; height = innerHeight; canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); }
  function stop() { if (frame) cancelAnimationFrame(frame); frame = 0; points = []; ctx.clearRect(0, 0, width, height); }
  function draw(t) {
    frame = 0; ctx.clearRect(0, 0, width, height);
    if (!enabled()) return stop();
    points = points.filter(p => t - p.t < 600);
    const dark = document.documentElement.dataset.theme === 'dark';
    ctx.font = '10px ui-monospace,Consolas,monospace';
    for (const p of points) { const life = 1 - (t - p.t) / 600; ctx.fillStyle = dark ? `rgba(128,194,247,${life * .48})` : `rgba(75,127,220,${life * .38})`; ctx.fillText(p.glyph, p.x + 10, p.y + 10 - (1 - life) * 8); }
    if (points.length) frame = requestAnimationFrame(draw);
  }
  document.addEventListener('pointermove', e => { if (!enabled() || e.pointerType !== 'mouse') return; const t = performance.now(); if (t - last < 36) return; last = t; points.push({ x: e.clientX, y: e.clientY, t, glyph: Math.random() < .5 ? '0' : '1' }); if (points.length > 18) points.shift(); if (!frame) frame = requestAnimationFrame(draw); }, { passive: true });
  window.addEventListener('resize', resize, { passive: true }); document.addEventListener('visibilitychange', stop); document.addEventListener('notice:appearance', stop); document.addEventListener('pointerleave', stop); reduce.addEventListener('change', stop); fine.addEventListener('change', stop); resize();
  window.NoticeEffects = Object.freeze({ status: () => ({ running: !!frame, particles: points.length, enabled: enabled() }) });
})();
