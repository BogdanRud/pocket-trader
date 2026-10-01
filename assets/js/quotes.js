/* ===== Live quotes: poll backend /api/prices, anchor every asset to real data ===== */
const LiveQuotes = (() => {
  let engines = null, onStatus = null, timer = null, enabled = false;
  let realMap = {};   // assetId -> bool (is the current price real)

  async function poll() {
    if (!enabled) return;
    try {
      const r = await fetch('/api/prices', { cache: 'no-store' });
      if (!r.ok) throw new Error('bad');
      const data = await r.json();
      let anyReal = false;
      Object.keys(data).forEach(id => {
        const d = data[id];
        if (engines[id] && d && isFinite(d.price)) {
          engines[id].setAnchor(d.price);
          realMap[id] = !!d.real;
          if (d.real) anyReal = true;
        }
      });
      onStatus && onStatus(anyReal ? 'live' : 'sim');
    } catch (e) {
      onStatus && onStatus('blocked');   // backend/prices unavailable -> simulation continues
    }
  }

  return {
    isReal(id) { return !!realMap[id]; },
    start(engs, statusCb) {
      engines = engs; onStatus = statusCb; enabled = true;
      poll(); timer = setInterval(poll, 4000);
    },
    stop() {
      enabled = false; clearInterval(timer); realMap = {};
      if (engines) Object.values(engines).forEach(e => e.clearAnchor());
      onStatus && onStatus('sim');
    },
  };
})();
