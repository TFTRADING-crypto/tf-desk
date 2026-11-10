/* Hand-drawn canvas charts. No chart library. devicePixelRatio aware. */
(function () {
  const C = { green: '#00d35a', red: '#ff453a', blue: '#0a84ff', orange: '#ff9f0a', sec: 'rgba(235,235,245,0.6)', ter: 'rgba(235,235,245,0.3)', sep: 'rgba(84,84,88,0.55)', card2: '#2c2c2e' };
  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function setup(cv) {
    const dpr = window.devicePixelRatio || 1;
    const r = cv.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  // Home LIVE line chart
  function line(cv, data, opt) {
    opt = opt || {};
    const st = cv._st || (cv._st = { prevLen: 0, t0: 0, markT0: {} });
    const pts = data.points || [];
    const grow = !reduced() && st.prevLen && pts.length > st.prevLen;
    if (grow) st.t0 = performance.now();
    st.prevLen = pts.length;
    const draw = (now) => {
      const { ctx, w, h } = setup(cv);
      const top = 64, bot = h - 12;
      const start = data.start;
      if (pts.length < 2) {
        // empty: dashed start line only
        const y = (top + bot) / 2;
        ctx.setLineDash([4, 5]); ctx.strokeStyle = C.ter; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); ctx.setLineDash([]);
        return;
      }
      const prog = grow ? Math.min(1, (now - st.t0) / 250) : 1;
      const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
      let lo = Math.min(start, ...pts.map(p => p[1])), hi = Math.max(start, ...pts.map(p => p[1]));
      if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
      const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
      const X = t => (t1 === t0 ? w : (t - t0) / (t1 - t0) * w);
      const Y = v => bot - (v - lo) / (hi - lo) * (bot - top);
      // the last point slides in from the previous one
      const P = pts.map(p => [X(p[0]), Y(p[1])]);
      if (prog < 1 && P.length >= 2) {
        const a = P[P.length - 2], b = P[P.length - 1];
        P[P.length - 1] = [a[0] + (b[0] - a[0]) * prog, a[1] + (b[1] - a[1]) * prog];
      }
      // dashed start line
      ctx.setLineDash([4, 5]); ctx.strokeStyle = C.ter; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, Y(start)); ctx.lineTo(w, Y(start)); ctx.stroke(); ctx.setLineDash([]);
      // gradient fill under the line
      const g = ctx.createLinearGradient(0, top, 0, bot);
      g.addColorStop(0, 'rgba(0,211,90,0.28)'); g.addColorStop(1, 'rgba(0,211,90,0)');
      ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]); P.forEach(p => ctx.lineTo(p[0], p[1]));
      ctx.lineTo(P[P.length - 1][0], bot); ctx.lineTo(P[0][0], bot); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]); P.forEach(p => ctx.lineTo(p[0], p[1]));
      ctx.strokeStyle = C.green; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
      // marks above the line, never overlapping: a later mark moves up a row
      ctx.font = '600 12px -apple-system, "SF Pro Text", sans-serif';
      const rows = [];
      let anim = prog < 1;
      (data.marks || []).forEach((m, i) => {
        if (m.ts < t0) return;
        const x = X(m.ts);
        const tw = ctx.measureText(m.label).width + 14;
        let x0 = Math.min(Math.max(2, x - tw / 2), w - tw - 2);
        let row = 0;
        while ((rows[row] || []).some(([a, b]) => !(x0 + tw < a || x0 > b))) row++;
        (rows[row] = rows[row] || []).push([x0 - 4, x0 + tw + 4]);
        const key = m.ts + m.label;
        if (!st.markT0[key]) st.markT0[key] = reduced() ? -1e9 : now;
        const a = Math.min(1, (now - st.markT0[key]) / 200); if (a < 1) anim = true;
        const y = Math.max(2, top - 24 - row * 24);
        ctx.globalAlpha = a;
        const col = m.color === 'blue' ? C.blue : m.color === 'green' ? C.green : C.red;
        rr(ctx, x0, y, tw, 20, 10); ctx.fillStyle = col; ctx.fill();
        ctx.fillStyle = m.color === 'green' ? '#000' : '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(m.label, x0 + 7, y + 10.5);
        ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y + 20); ctx.lineTo(x, top - 2); ctx.stroke();
        ctx.globalAlpha = 1;
      });
      // last point dot
      const L = P[P.length - 1]; ctx.beginPath(); ctx.arc(L[0] - 3, L[1], 3.5, 0, 7); ctx.fillStyle = C.green; ctx.fill();
      if (anim) requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  }

  // Coin screen 1-minute candles with volume + orange dashed exit line
  function candles(cv, cs, opt) {
    opt = opt || {};
    const { ctx, w, h } = setup(cv);
    const volH = 40, top = 10, bot = h - volH - 14;
    if (!cs || !cs.length) {
      ctx.fillStyle = C.sec; ctx.font = '14px -apple-system, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('No candles yet', w / 2, h / 2); ctx.textAlign = 'left'; return;
    }
    const lines = [opt.exitLine, opt.entry].filter(v => v);
    let lo = Math.min(...cs.map(c => c.l), ...lines), hi = Math.max(...cs.map(c => c.h), ...lines);
    if (hi - lo < hi * 1e-6) { hi *= 1.01; lo *= 0.99; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const Y = v => bot - (v - lo) / (hi - lo) * (bot - top);
    const n = Math.max(cs.length, 30), cw = w / n, bw = Math.max(2, cw * 0.62);
    const vmax = Math.max(1, ...cs.map(c => c.v || 0));
    cs.forEach((c, i) => {
      const x = w - (cs.length - i) * cw + cw / 2;
      const up = c.c >= c.o, col = up ? C.green : C.red;
      ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, Y(c.h)); ctx.lineTo(x, Y(c.l)); ctx.stroke();
      const y1 = Y(Math.max(c.o, c.c)), y2 = Y(Math.min(c.o, c.c));
      ctx.fillStyle = col; ctx.fillRect(x - bw / 2, y1, bw, Math.max(1, y2 - y1));
      const vh = (c.v || 0) / vmax * volH;
      ctx.fillStyle = 'rgba(255,159,10,0.55)'; ctx.fillRect(x - bw / 2, h - vh, bw, vh);
    });
    if (opt.exitLine) {
      const y = Y(opt.exitLine);
      ctx.setLineDash([5, 4]); ctx.strokeStyle = C.orange; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = C.orange; ctx.font = '600 11px -apple-system, sans-serif'; ctx.fillText('Risk trailing stop', 4, y - 5);
    }
  }

  // Analyst score ring 0-100, green from min score
  function ring(cv, score, minScore) {
    const { ctx, w, h } = setup(cv);
    const r = Math.min(w, h) / 2 - 8, cx = w / 2, cy = h / 2;
    ctx.lineWidth = 12; ctx.lineCap = 'round';
    ctx.strokeStyle = C.card2; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    if (score != null) {
      ctx.strokeStyle = score >= minScore ? C.green : '#ffd60a';
      ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.001, score / 100)); ctx.stroke();
    }
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '600 40px -apple-system, "SF Pro Display", sans-serif';
    ctx.fillText(score == null ? '–' : String(score), cx, cy);
    ctx.textAlign = 'left';
  }

  window.Charts = { line, candles, ring };
})();
