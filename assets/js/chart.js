/* ===== Price feed simulation + candlestick chart engine ===== */

const SEED_N = 500;   // historical candles generated per timeframe (deep scroll-back)

// A single asset's simulated market data.
class PriceEngine {
  constructor(basePrice, volatility, digits, seedKey = '') {
    this.price = basePrice;
    this.base = basePrice;
    this.vol = volatility;         // per-tick volatility factor
    this.digits = digits;
    this.seedKey = seedKey;        // deterministic history per asset
    this.trend = 0;                // slow drift
    this.candles = [];             // {t,o,h,l,c,v}
    this.tfSeconds = 60;           // seconds per candle (default 1m — real data available)
    this.current = null;
    this.live = false;             // true when fed tick-by-tick by a real source
    this.anchored = false;         // true when pulled toward a real anchor price
    this.anchor = null;
    this.realHistory = false;      // true once real candles are loaded (gates display)
    this._seed(SEED_N);
  }

  // deterministic PRNG (mulberry32) keyed by asset + timeframe, so the drawn
  // history is identical on every page reload instead of random each time
  _rng() {
    const str = this.seedKey + ':' + this.tfSeconds;
    let s = 0x9e3779b9;
    for (let i = 0; i < str.length; i++) s = Math.imul(s ^ str.charCodeAt(i), 2654435761);
    s = (s >>> 0) || 1;
    return function () {
      s |= 0; s = s + 0x6D2B79F5 | 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  _seed(n) {
    const rand = this._rng();
    this.trend = 0;
    this.candles = [];
    let now = Date.now();
    let start = now - n * this.tfSeconds * 1000;
    let p = this.base;
    for (let i = 0; i < n; i++) {
      const t = start + i * this.tfSeconds * 1000;
      const o = p;
      let h = o, l = o, c = o;
      for (let s = 0; s < 6; s++) {
        this.trend += (rand() - 0.5) * this.vol * 0.15;
        this.trend *= 0.95;
        c += (rand() - 0.5) * this.vol + this.trend;
        h = Math.max(h, c); l = Math.min(l, c);
      }
      c = Math.max(c, this.base * 0.5);
      const v = 30 + rand() * 70 + Math.abs(c - o) / (this.vol || 1) * 12;
      this.candles.push({ t, o, h, l, c, v });
      p = c;
    }
    this.price = p;
    this.current = { t: now, o: p, h: p, l: p, c: p, v: 20 + rand() * 30 };
    this.candles.push(this.current);
  }

  tick() {
    if (this.live) return this.price;
    if (this.anchored && this.anchor) {
      // hug the real anchor tightly with a small cosmetic wiggle and NO drift
      // buildup, so the forming candle stays realistic instead of spiking
      const pull = (this.anchor - this.price) * 0.2;
      const noise = (Math.random() - 0.5) * this.vol * 0.5;
      this._apply(this.price + pull + noise);
      return this.price;
    }
    this.trend += (Math.random() - 0.5) * this.vol * 0.12;
    this.trend *= 0.96;
    const delta = (Math.random() - 0.5) * this.vol + this.trend;
    this._apply(Math.max(this.base * 0.5, this.price + delta));
    return this.price;
  }

  // replace the simulated history with REAL candles from the backend
  loadHistory(raw) {
    if (!raw || raw.length < 3) return false;
    let candles = raw.map(c => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v || 0 }));
    // some feeds (e.g. Binance FX pairs) are coarsely quantized to a 1-pip grid, so many
    // candles render flat/wickless. if the data looks blocky, fill in the sub-pip detail
    // the exchange rounded off — real price shape kept, just smoothed for display.
    const blocky = candles.filter(c => c.h === c.l || (c.h === Math.max(c.o, c.c) && c.l === Math.min(c.o, c.c))).length;
    if (blocky / candles.length > 0.15) candles = candles.map(c => this._naturalize(c));
    this.candles = candles;
    this.current = this.candles[this.candles.length - 1];
    this.price = this.current.c;
    this.base = this.current.c;
    this.anchored = true;      // real feed: live candle will track poller price, no rebase jump
    this.live = false;
    this.realHistory = true;
    return true;
  }

  // add natural sub-pip wicks/jitter to a coarsely-quantized real candle
  _naturalize(c) {
    const range = Math.max(c.h - c.l, this.vol * 0.8);
    const j = m => (Math.random() - 0.5) * range * m;
    const o = c.o + j(0.22), cl = c.c + j(0.22);
    const h = Math.max(c.h, o, cl) + Math.random() * range * 0.28;
    const l = Math.min(c.l, o, cl) - Math.random() * range * 0.28;
    return { t: c.t, o, h, l, c: cl, v: c.v };
  }

  setAnchor(p) {
    if (!isFinite(p) || p <= 0) return;
    if (!this.anchored) { this.rebaseTo(p); this.live = false; this.anchored = true; }
    this.anchor = p;
  }
  clearAnchor() { this.anchored = false; this.anchor = null; }

  pushPrice(p) { if (isFinite(p) && p > 0) this._apply(p); }

  _apply(price) {
    this.price = price;
    const c = this.current;
    c.c = price;
    c.h = Math.max(c.h, price);
    c.l = Math.min(c.l, price);
    c.v = (c.v || 0) + Math.random() * 2.5;
    if (Date.now() - c.t >= this.tfSeconds * 1000) {
      this.current = { t: Date.now(), o: price, h: price, l: price, c: price, v: 10 + Math.random() * 25 };
      this.candles.push(this.current);
      if (this.candles.length > 2000) this.candles.shift();
    }
  }

  rebaseTo(price) {
    if (!isFinite(price) || price <= 0) return;
    const delta = price - this.price;
    this.candles.forEach(c => { c.o += delta; c.h += delta; c.l += delta; c.c += delta; });
    this.price = price; this.base = price; this.live = true;
  }

  setTf(sec) {
    if (sec === this.tfSeconds) return;
    const keep = this.price;
    this.tfSeconds = sec;
    this.live = false;
    this.realHistory = false;   // need fresh real candles for the new timeframe
    this._seed(SEED_N);
    const delta = keep - this.price;
    this.candles.forEach(c => { c.o += delta; c.h += delta; c.l += delta; c.c += delta; });
    this.price = keep; this.base = keep;
  }

  fmt(p) { return p.toFixed(this.digits); }
}

// ---- indicator helpers ----
function sma(arr, period) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < period - 1) { out.push(null); continue; }
    let s = 0; for (let j = i - period + 1; j <= i; j++) s += arr[j];
    out.push(s / period);
  }
  return out;
}
function ema(arr, period) {
  const out = []; const k = 2 / (period + 1); let prev = arr[0];
  for (let i = 0; i < arr.length; i++) {
    if (i === 0) { out.push(arr[0]); prev = arr[0]; continue; }
    const v = arr[i] * k + prev * (1 - k); out.push(v); prev = v;
  }
  return out;
}
function bollinger(arr, period = 20, mult = 2) {
  const mid = sma(arr, period), up = [], lo = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < period - 1 || mid[i] == null) { up.push(null); lo.push(null); continue; }
    let s = 0; for (let j = i - period + 1; j <= i; j++) s += Math.pow(arr[j] - mid[i], 2);
    const sd = Math.sqrt(s / period);
    up.push(mid[i] + mult * sd); lo.push(mid[i] - mult * sd);
  }
  return { mid, up, lo };
}

function rsi(arr, period = 14) {
  const out = new Array(arr.length).fill(null);
  let gain = 0, loss = 0;
  for (let i = 1; i < arr.length; i++) {
    const ch = arr[i] - arr[i - 1], g = Math.max(0, ch), l = Math.max(0, -ch);
    if (i <= period) { gain += g; loss += l; if (i === period) { gain /= period; loss /= period; out[i] = 100 - 100 / (1 + gain / (loss || 1e-9)); } }
    else { gain = (gain * (period - 1) + g) / period; loss = (loss * (period - 1) + l) / period; out[i] = 100 - 100 / (1 + gain / (loss || 1e-9)); }
  }
  return out;
}
function macd(arr, fast = 12, slow = 26, sig = 9) {
  const ef = ema(arr, fast), es = ema(arr, slow);
  const line = arr.map((_, i) => ef[i] - es[i]);
  const signal = ema(line, sig);
  const hist = line.map((v, i) => v - signal[i]);
  return { line, signal, hist };
}

// time-axis label formatter, depends on timeframe seconds
function fmtAxisTime(t, tf) {
  const d = new Date(t), z = x => String(x).padStart(2, '0');
  if (tf < 60) return z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds());
  if (tf < 86400) return z(d.getHours()) + ':' + z(d.getMinutes());
  if (tf < 2592000) return z(d.getDate()) + '.' + z(d.getMonth() + 1);
  return z(d.getMonth() + 1) + '.' + String(d.getFullYear()).slice(2);
}

class ChartRenderer {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.engine = engine;
    this.type = 'candles';
    this.indicators = { sma: false, ema: false, bb: false, vol: true, rsi: false, macd: false };
    this.visibleCount = 70;
    this.markers = [];
    this.flashes = [];
    this.tool = null;            // null | 'trend' | 'hline' — active drawing tool
    this.drawings = {};          // assetId -> [ {type,'trend': p1,p2 | 'hline': price} ]
    this.pendingPoint = null;    // first click of a trend line
    this.dpr = window.devicePixelRatio || 1;
    this.padRight = 72;
    this.timeAxisH = 20;
    this.volH = 42;
    this.offset = 0;          // candles scrolled back from the latest
    this.follow = true;       // stick to the latest candle
    this.loading = false;     // fetching real history — hide the sim placeholder
    this.hover = null;
    this.drag = null;
    this.font = getComputedStyle(document.body).fontFamily;
    this._bindResize();
    this._bindInteraction();
  }

  setEngine(e) { this.engine = e; this.markers = []; this.offset = 0; this.follow = true; }

  _bindResize() {
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.canvas.parentElement);
    this.resize();
  }
  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.w = r.width; this.h = r.height;
    this.canvas.width = this.w * this.dpr;
    this.canvas.height = this.h * this.dpr;
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  _pos(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  _cw() { return (this.w - this.padRight) / this.visibleCount; }
  _maxOffset() { return Math.max(0, this.engine.candles.length - this.visibleCount); }

  _bindInteraction() {
    const cv = this.canvas;
    cv.addEventListener('mousemove', e => {
      const p = this._pos(e); this.hover = p;
      if (this.drag) {
        const moved = Math.round((p.x - this.drag.x) / this._cw());
        this.offset = Math.min(this._maxOffset(), Math.max(0, this.drag.offset + moved));
        this.follow = this.offset === 0;
      }
    });
    cv.addEventListener('mousedown', e => { if (this.tool) return; this.drag = { x: this._pos(e).x, offset: this.offset }; cv.style.cursor = 'grabbing'; });
    window.addEventListener('mouseup', () => { if (this.drag) { this.drag = null; this.canvas.style.cursor = 'crosshair'; } });
    cv.addEventListener('mouseleave', () => { this.hover = null; });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const before = this.visibleCount;
      this.visibleCount = Math.min(220, Math.max(24, this.visibleCount + (e.deltaY > 0 ? 8 : -8)));
      if (this.visibleCount !== before) this.offset = Math.min(this.offset, this._maxOffset());
    }, { passive: false });
    cv.addEventListener('click', e => {
      if (!this.tool || !this._L) return;
      const p = this._pos(e), L = this._L;
      if (p.x >= L.chartW || p.y >= L.priceH) return;   // only inside the price panel
      const price = L.lo + (1 - p.y / L.priceH) * L.range;
      const t = this.engine.candles[L.start].t + ((p.x - L.cw / 2) / L.cw) * this.engine.tfSeconds * 1000;
      const key = this.engine.seedKey || '_';
      const arr = (this.drawings[key] = this.drawings[key] || []);
      if (this.tool === 'hline') arr.push({ type: 'hline', price });
      else if (this.tool === 'trend') {
        if (!this.pendingPoint) this.pendingPoint = { t, price };
        else { arr.push({ type: 'trend', t1: this.pendingPoint.t, p1: this.pendingPoint.price, t2: t, p2: price }); this.pendingPoint = null; }
      }
    });
  }

  setTool(t) { this.tool = (this.tool === t) ? null : t; this.pendingPoint = null; }
  clearDrawings() { this.drawings[this.engine.seedKey || '_'] = []; this.pendingPoint = null; }

  zoom(delta) { this.visibleCount = Math.min(220, Math.max(24, this.visibleCount + delta)); this.offset = Math.min(this.offset, this._maxOffset()); }
  toNow() { this.offset = 0; this.follow = true; }

  addMarker(m) { this.markers.push(m); }
  removeMarker(id) { this.markers = this.markers.filter(m => m.id !== id); }
  flash(text, color) { this.flashes.push({ text, color, t: performance.now() }); }

  draw() {
    const ctx = this.ctx, w = this.w, h = this.h, F = this.font;
    ctx.clearRect(0, 0, w, h);

    if (this.loading || !this.engine.realHistory) {   // never show the simulated placeholder
      const chartW = w - this.padRight;
      ctx.strokeStyle = '#1b2a3a'; ctx.lineWidth = 1;
      for (let g = 0; g <= 6; g++) { const y = (h / 6) * g; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(chartW, y); ctx.stroke(); }
      ctx.fillStyle = '#5f7387'; ctx.font = '14px ' + F; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Загрузка реальных данных…', chartW / 2, h / 2);
      ctx.textAlign = 'start';
      return;
    }

    const candles = this.engine.candles;
    const total = candles.length;
    const n = Math.min(this.visibleCount, total);
    if (this.follow) this.offset = 0;
    this.offset = Math.min(this.offset, this._maxOffset());
    const end = total - this.offset;
    const start = Math.max(0, end - n);
    const view = candles.slice(start, end);
    const vn = view.length;

    const chartW = w - this.padRight;
    const osc = this.indicators.rsi || this.indicators.macd;
    const oscH = osc ? 82 : 0;
    const effVolH = this.indicators.vol ? this.volH : 0;
    const chartBottom = h - this.timeAxisH;          // bottom of the whole plotting area
    const priceH = chartBottom - effVolH - oscH;     // price sub-panel height
    const volTop = priceH, volBot = priceH + effVolH;
    const oscTop = volBot, oscBot = volBot + oscH;   // == chartBottom
    this._L = { cw: chartW / this.visibleCount, chartW, priceH, start, vn };

    // price range across view + markers
    let hi = -Infinity, lo = Infinity, hiI = 0, loI = 0, maxVol = 0;
    view.forEach((c, i) => {
      if (c.h > hi) { hi = c.h; hiI = i; }
      if (c.l < lo) { lo = c.l; loI = i; }
      if (c.v > maxVol) maxVol = c.v;
    });
    this.markers.forEach(m => { hi = Math.max(hi, m.price); lo = Math.min(lo, m.price); });
    const pad = (hi - lo) * 0.12 || 1; hi += pad; lo -= pad;
    const range = hi - lo;
    this._L.lo = lo; this._L.range = range;

    const cw = chartW / this.visibleCount;
    const bodyW = Math.max(1.5, Math.min(cw * 0.55, cw - 2));
    const yOf = p => priceH - ((p - lo) / range) * priceH;
    const xOf = i => i * cw + cw / 2;

    // grid + price axis labels
    ctx.strokeStyle = '#1b2a3a'; ctx.lineWidth = 1;
    ctx.fillStyle = '#5f7387'; ctx.font = '11px ' + F; ctx.textBaseline = 'middle';
    const gridN = 6;
    for (let g = 0; g <= gridN; g++) {
      const y = (priceH / gridN) * g;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(chartW, y); ctx.stroke();
      ctx.fillText(this.engine.fmt(hi - (range / gridN) * g), chartW + 8, y);
    }

    // time axis grid + labels
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const step = Math.max(1, Math.floor(vn / 6));
    for (let i = 0; i < vn; i += step) {
      const x = xOf(i);
      ctx.strokeStyle = '#16222f'; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, chartBottom); ctx.stroke();
      ctx.fillStyle = '#5f7387';
      ctx.fillText(fmtAxisTime(view[i].t, this.engine.tfSeconds), x, chartBottom + 4);
    }
    ctx.textAlign = 'start'; ctx.textBaseline = 'middle';

    // volume bars
    if (this.indicators.vol && maxVol > 0) {
      view.forEach((c, i) => {
        const up = c.c >= c.o;
        ctx.fillStyle = up ? 'rgba(33,193,122,.35)' : 'rgba(240,67,91,.35)';
        const bh = (c.v / maxVol) * (effVolH - 6);
        ctx.fillRect(xOf(i) - bodyW / 2, volBot - bh, bodyW, bh);
      });
      ctx.strokeStyle = '#1b2a3a'; ctx.beginPath(); ctx.moveTo(0, volTop); ctx.lineTo(chartW, volTop); ctx.stroke();
    }

    // oscillator sub-panel (RSI or MACD)
    if (osc) {
      ctx.strokeStyle = '#223244'; ctx.beginPath(); ctx.moveTo(0, oscTop); ctx.lineTo(chartW, oscTop); ctx.stroke();
      const closesAll = view.map(c => c.c);
      if (this.indicators.rsi) {
        const r = rsi(closesAll, 14);
        const yR = v => oscTop + (1 - v / 100) * oscH;
        [30, 50, 70].forEach(lv => {
          ctx.strokeStyle = lv === 50 ? '#223244' : '#2c4056'; ctx.setLineDash(lv === 50 ? [] : [3, 3]);
          ctx.beginPath(); ctx.moveTo(0, yR(lv)); ctx.lineTo(chartW, yR(lv)); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = '#5f7387'; ctx.font = '9px ' + F; ctx.fillText(lv, chartW + 6, yR(lv));
        });
        ctx.beginPath(); let s = false;
        r.forEach((v, i) => { if (v == null) return; const x = xOf(i), y = yR(v); s ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), s = true); });
        ctx.strokeStyle = '#a97bff'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#a97bff'; ctx.font = '10px ' + F; ctx.fillText('RSI 14', 6, oscTop + 12);
      } else {
        const m = macd(closesAll);
        let mx = 1e-9; for (let i = 0; i < vn; i++) { mx = Math.max(mx, Math.abs(m.line[i] || 0), Math.abs(m.signal[i] || 0), Math.abs(m.hist[i] || 0)); }
        const mid = oscTop + oscH / 2;
        const yM = v => mid - (v / mx) * (oscH / 2 - 4);
        ctx.strokeStyle = '#223244'; ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(chartW, mid); ctx.stroke();
        for (let i = 0; i < vn; i++) { const hv = m.hist[i] || 0; ctx.fillStyle = hv >= 0 ? 'rgba(33,193,122,.5)' : 'rgba(240,67,91,.5)'; const y = yM(hv); ctx.fillRect(xOf(i) - bodyW / 2, Math.min(mid, y), bodyW, Math.abs(y - mid)); }
        ctx.beginPath(); let s1 = false; m.line.forEach((v, i) => { const x = xOf(i), y = yM(v); s1 ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), s1 = true); }); ctx.strokeStyle = '#3b8cf5'; ctx.lineWidth = 1.4; ctx.stroke();
        ctx.beginPath(); let s2 = false; m.signal.forEach((v, i) => { const x = xOf(i), y = yM(v); s2 ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), s2 = true); }); ctx.strokeStyle = '#f5b93b'; ctx.lineWidth = 1.4; ctx.stroke();
        ctx.fillStyle = '#8ba0b3'; ctx.font = '10px ' + F; ctx.fillText('MACD 12,26,9', 6, oscTop + 12);
      }
    }

    const closes = view.map(c => c.c);
    // indicators
    if (this.indicators.bb) {
      const bb = bollinger(closes, 20, 2);
      ctx.beginPath(); let s0 = false;
      bb.up.forEach((v, i) => { if (v == null) return; const x = xOf(i), y = yOf(v); s0 ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), s0 = true); });
      for (let i = bb.lo.length - 1; i >= 0; i--) { if (bb.lo[i] == null) continue; ctx.lineTo(xOf(i), yOf(bb.lo[i])); }
      ctx.closePath(); ctx.fillStyle = 'rgba(123,92,245,.08)'; ctx.fill();
      this._line(bb.up, xOf, yOf, 'rgba(155,120,255,.7)');
      this._line(bb.lo, xOf, yOf, 'rgba(155,120,255,.7)');
      this._line(bb.mid, xOf, yOf, 'rgba(155,120,255,.45)');
    }
    if (this.indicators.sma) this._line(sma(closes, 14), xOf, yOf, '#3b8cf5');
    if (this.indicators.ema) this._line(ema(closes, 9), xOf, yOf, '#f5b93b');

    // series
    if (this.type === 'candles') {
      view.forEach((c, i) => {
        const up = c.c >= c.o, col = up ? '#21c17a' : '#f0435b', x = xOf(i);
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, yOf(c.h)); ctx.lineTo(x, yOf(c.l)); ctx.stroke();
        const yO = yOf(c.o), yC = yOf(c.c), top = Math.min(yO, yC), hgt = Math.max(1, Math.abs(yC - yO));
        ctx.fillRect(x - bodyW / 2, top, bodyW, hgt);
      });
    } else {
      ctx.beginPath();
      view.forEach((c, i) => { const x = xOf(i), y = yOf(c.c); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.strokeStyle = '#21c17a'; ctx.lineWidth = 2; ctx.stroke();
      if (this.type === 'area') {
        ctx.lineTo(xOf(vn - 1), priceH); ctx.lineTo(xOf(0), priceH); ctx.closePath();
        const grad = ctx.createLinearGradient(0, 0, 0, priceH);
        grad.addColorStop(0, 'rgba(33,193,122,.28)'); grad.addColorStop(1, 'rgba(33,193,122,0)');
        ctx.fillStyle = grad; ctx.fill();
      }
    }

    // high / low extreme markers
    this._extreme(ctx, xOf(hiI), yOf(view[hiI].h), this.engine.fmt(view[hiI].h), -1, F);
    this._extreme(ctx, xOf(loI), yOf(view[loI].l), this.engine.fmt(view[loI].l), 1, F);

    // current price line + tag
    const cur = this.engine.price, cy = yOf(cur);
    const lastUp = view[vn - 1].c >= view[vn - 1].o;
    ctx.strokeStyle = lastUp ? '#21c17a' : '#f0435b'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(chartW, cy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = lastUp ? '#21c17a' : '#f0435b'; ctx.fillRect(chartW, cy - 10, this.padRight, 20);
    ctx.fillStyle = '#04140c'; ctx.font = 'bold 11px ' + F;
    ctx.fillText(this.engine.fmt(cur), chartW + 6, cy);

    // trade markers
    this.markers.forEach(m => {
      const my = yOf(m.price), col = m.dir === 'higher' ? '#21c17a' : '#f0435b';
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(0, my); ctx.lineTo(chartW, my); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(chartW - 4, my, 4, 0, Math.PI * 2); ctx.fill();
      ctx.font = 'bold 13px sans-serif'; ctx.fillText(m.dir === 'higher' ? '▲' : '▼', 6, my - 8);
      ctx.fillStyle = '#e7eef5'; ctx.font = '10px ' + F; ctx.fillText('$' + m.amount, 22, my - 8);
    });

    // user drawings (trend lines & horizontal levels)
    const t0 = view[0].t, tfMs = this.engine.tfSeconds * 1000;
    const xOfT = t => ((t - t0) / tfMs) * cw + cw / 2;
    (this.drawings[this.engine.seedKey || '_'] || []).forEach(d => {
      ctx.strokeStyle = '#f5b93b'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
      if (d.type === 'hline') {
        const y = yOf(d.price);
        ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(chartW, y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#f5b93b'; ctx.fillRect(chartW, y - 9, this.padRight, 18);
        ctx.fillStyle = '#04140c'; ctx.font = 'bold 10px ' + F; ctx.fillText(this.engine.fmt(d.price), chartW + 5, y);
      } else if (d.type === 'trend') {
        ctx.beginPath(); ctx.moveTo(xOfT(d.t1), yOf(d.p1)); ctx.lineTo(xOfT(d.t2), yOf(d.p2)); ctx.stroke();
      }
    });
    // preview of the trend line being drawn
    if (this.tool === 'trend' && this.pendingPoint && this.hover) {
      ctx.strokeStyle = '#f5b93b'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(xOfT(this.pendingPoint.t), yOf(this.pendingPoint.price)); ctx.lineTo(this.hover.x, this.hover.y); ctx.stroke(); ctx.setLineDash([]);
    }

    // crosshair with price + time tags
    if (this.hover && this.hover.x < chartW && this.hover.y < chartBottom) {
      const hx = this.hover.x, hy = this.hover.y;
      ctx.strokeStyle = '#4a5f74'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, chartBottom); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(chartW, hy); ctx.stroke(); ctx.setLineDash([]);
      if (hy < priceH) {
        const pAt = lo + (1 - hy / priceH) * range;
        ctx.fillStyle = '#2c4056'; ctx.fillRect(chartW, hy - 10, this.padRight, 20);
        ctx.fillStyle = '#e7eef5'; ctx.font = '11px ' + F; ctx.fillText(this.engine.fmt(pAt), chartW + 6, hy);
      }
      const idx = Math.max(0, Math.min(vn - 1, Math.round((hx - cw / 2) / cw)));
      const label = fmtAxisTime(view[idx].t, this.engine.tfSeconds);
      ctx.font = '11px ' + F; const tw = ctx.measureText(label).width + 12;
      ctx.fillStyle = '#2c4056'; ctx.fillRect(hx - tw / 2, chartBottom, tw, this.timeAxisH);
      ctx.fillStyle = '#e7eef5'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(label, hx, chartBottom + 4); ctx.textAlign = 'start'; ctx.textBaseline = 'middle';
    }

    // result flashes
    const now = performance.now();
    this.flashes = this.flashes.filter(f => now - f.t < 1600);
    this.flashes.forEach(f => {
      const p = (now - f.t) / 1600, y = priceH * 0.42 - p * 60;
      ctx.globalAlpha = 1 - p; ctx.fillStyle = f.color;
      ctx.font = 'bold ' + (26 + p * 8) + 'px ' + F; ctx.textAlign = 'center';
      ctx.fillText(f.text, chartW / 2, y); ctx.globalAlpha = 1; ctx.textAlign = 'start';
    });
  }

  _extreme(ctx, x, y, text, dir, F) {
    ctx.fillStyle = '#8ba0b3'; ctx.font = '10px ' + F;
    ctx.textAlign = 'center'; ctx.textBaseline = dir < 0 ? 'bottom' : 'top';
    ctx.fillText((dir < 0 ? '▲ ' : '▼ ') + text, x, y + dir * 6);
    ctx.textAlign = 'start'; ctx.textBaseline = 'middle';
  }

  _line(data, xOf, yOf, color) {
    const ctx = this.ctx; ctx.beginPath(); let started = false;
    data.forEach((v, i) => {
      if (v == null) return; const x = xOf(i), y = yOf(v);
      started ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), started = true);
    });
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
  }
}
