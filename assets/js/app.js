/* ===== Pocket Trader — trading app logic ===== */

// --- auth guard ---
const _user = Store.currentUser();
if (!_user) { location.href = 'index.html'; }

// ---- asset catalogue (real data; sources mapped on the backend by id) ----
const CCY_SYM = { USD:'$', EUR:'€', GBP:'£', JPY:'¥', CHF:'F', CAD:'C', AUD:'A', NZD:'N' };
const CCY_COL = { EUR:'#3b8cf5', GBP:'#5c6bc0', USD:'#26a69a', AUD:'#00897b', NZD:'#66bb6a', CHF:'#ef5350', CAD:'#ff7043', JPY:'#ec407a' };
// forex: [id, approxBase, payout]  (base is a placeholder — the chart rebases to the real price)
const _FX = [
  ['EURUSD',1.16,92],['GBPUSD',1.35,90],['USDJPY',154,87],['USDCHF',0.80,86],
  ['USDCAD',1.38,86],['AUDUSD',0.65,85],['NZDUSD',0.60,84],['EURGBP',0.86,88],
  ['EURJPY',179,87],['GBPJPY',208,86],['EURCHF',0.93,85],['AUDJPY',100,85],
  ['CADJPY',111,84],['CHFJPY',193,84],['NZDJPY',92,83],['EURCAD',1.60,85],
  ['EURAUD',1.78,84],['GBPCHF',1.08,84],['GBPCAD',1.86,83],['AUDCAD',0.90,85],['AUDNZD',1.08,83],
];
// crypto: [id, name, base, digits, payout, abbr, color]
const _CR = [
  ['BTCUSD','BTC/USD',64000,1,88,'₿','#f7931a'],['ETHUSD','ETH/USD',3400,2,86,'Ξ','#627eea'],
  ['SOLUSD','SOL/USD',148,2,84,'◎','#14f195'],['BNBUSD','BNB/USD',600,2,85,'B','#f3ba2f'],
  ['XRPUSD','XRP/USD',0.6,4,84,'X','#5aa9c9'],['ADAUSD','ADA/USD',0.5,4,83,'A','#3468d1'],
  ['DOGEUSD','DOGE/USD',0.12,5,82,'Ð','#c2a633'],['LTCUSD','LTC/USD',90,2,83,'Ł','#5b7bb0'],
];
// metals / stocks / indices: [id, name, type, base, digits, payout, abbr, color]
const _OTHER = [
  ['XAUUSD','Gold','commodity',2358,2,83,'Au','#ffd54f'],['XAGUSD','Silver','commodity',29,3,81,'Ag','#b0bec5'],
  ['AAPL','Apple','stock',214,2,80,'A','#a2aaad'],['TSLA','Tesla','stock',242,2,82,'T','#e82127'],
  ['MSFT','Microsoft','stock',430,2,80,'M','#00a4ef'],['AMZN','Amazon','stock',185,2,80,'Az','#ff9900'],
  ['NVDA','Nvidia','stock',120,2,81,'N','#76b900'],
  ['SP500','S&P 500','index',5470,1,79,'S&','#66bb6a'],['NAS100','Nasdaq 100','index',19000,1,79,'Nq','#3b8cf5'],
  ['DJI','Dow Jones','index',39000,1,78,'DJ','#7b5cf5'],
];
const ASSETS = [];
_FX.forEach(([id, base, payout]) => {
  const b = id.slice(0, 3), q = id.slice(3, 6), jpy = q === 'JPY';
  ASSETS.push({ id, name: b + '/' + q, type: 'currency', otc: false, payout,
    base, vol: base * 0.0002, digits: jpy ? 3 : 5,
    color: CCY_COL[b] || '#3b8cf5', abbr: (CCY_SYM[b] || b[0]) + (CCY_SYM[q] || q[0]) });
});
_CR.forEach(([id, name, base, digits, payout, abbr, color]) =>
  ASSETS.push({ id, name, type: 'crypto', otc: false, payout, base, vol: base * 0.0006, digits, color, abbr }));
_OTHER.forEach(([id, name, type, base, digits, payout, abbr, color]) =>
  ASSETS.push({ id, name, type, otc: false, payout, base, vol: base * 0.0004, digits, color, abbr }));

const TIMES = [
  { label:'15s', sec:15 }, { label:'30s', sec:30 }, { label:'1m', sec:60 },
  { label:'3m', sec:180 }, { label:'5m', sec:300 }, { label:'15m', sec:900 },
  { label:'30m', sec:1800 }, { label:'1ч', sec:3600 }, { label:'1д', sec:86400 },
  { label:'1нед', sec:604800 }, { label:'1мес', sec:2592000 },
];
const TIMEFRAMES = [
  { label:'1m',  sec:60,    g:'Минуты'  }, { label:'2m',  sec:120,   g:'Минуты'  },
  { label:'3m',  sec:180,   g:'Минуты'  }, { label:'5m',  sec:300,   g:'Минуты'  },
  { label:'15m', sec:900,   g:'Минуты'  }, { label:'30m', sec:1800,  g:'Минуты'  },
  { label:'1H',  sec:3600,  g:'Часы'    }, { label:'4H',  sec:14400, g:'Часы'    },
  { label:'1D',  sec:86400, g:'Дни'     }, { label:'1W',  sec:604800, g:'Дни'    },
  { label:'1Mo', sec:2592000, g:'Крупные' }, { label:'1Y', sec:31536000, g:'Крупные' },
];

// state is built once persisted data is loaded from the backend
let state, chart;

function buildState(saved) {
  state = {
    account: saved.account || 'demo',
    balances: saved.balances || { demo: 10000, real: 0 },
    amount: 10,
    expirySec: 60,
    asset: ASSETS[0],
    engines: {},
    trades: saved.trades || [],
    pending: saved.pending || [],
    history: saved.history || [],
    filter: 'all',
    search: '',
    favorites: new Set(Array.isArray(saved.favorites) ? saved.favorites : ['EURUSD','BTCUSD']),
    wins: saved.wins || 0, losses: saved.losses || 0, ties: saved.ties || 0,
    streak: 0, bestStreak: saved.bestStreak || 0,
    tradesTab: 'active',
    orderMode: 'market',
    settings: saved.settings || { sound: true, liveQuotes: true },
  };
  ASSETS.forEach(a => state.engines[a.id] = new PriceEngine(a.base, a.vol, a.digits, a.id));
}
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const fmtMoney = v => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function persist() { return Store.saveState(null, state); }

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const b = document.querySelector('#themeToggle'); if (b) b.textContent = theme === 'light' ? '☀️' : '🌙';
}

/* ---------- Sound (WebAudio) ---------- */
const Sound = (() => {
  let ctx;
  function beep(freq, dur, type = 'sine', vol = 0.12) {
    if (!state.settings.sound) return;
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + dur);
    } catch (e) {}
  }
  return {
    place() { beep(520, 0.12, 'triangle'); },
    win() { beep(660, 0.12, 'sine'); setTimeout(() => beep(880, 0.18, 'sine'), 110); },
    loss() { beep(300, 0.22, 'sawtooth', 0.09); },
    tie() { beep(440, 0.15, 'sine', 0.08); },
    trigger() { beep(600, 0.1, 'square', 0.09); },
  };
})();

/* ---------- init ---------- */
function init() {
  // user menu
  (() => {
    const av = $('#userAvatar'), initial = (_user.name || _user.email || '?')[0].toUpperCase();
    if (_user.avatar && _user.avatar.slice(0, 5) === 'data:') {
      av.style.backgroundImage = `url(${_user.avatar})`; av.style.backgroundSize = 'cover'; av.style.backgroundPosition = 'center'; av.textContent = '';
    } else { av.textContent = _user.avatar || initial; }
  })();
  $('#udName').textContent = _user.name || 'Пользователь';
  $('#udEmail').textContent = _user.guest ? 'Гостевой режим' : _user.email;

  chart = new ChartRenderer($('#chart'), state.engines[state.asset.id]);
  $('#indVol').classList.toggle('on', chart.indicators.vol);
  renderAssets();
  renderTimes();
  renderAmount();
  selectAsset(state.asset.id, true);
  updateBalance();
  bindUI();
  loop();
  setInterval(tickAll, 200);
  setInterval(processTrades, 250);

  // start live quotes if enabled
  if (state.settings.liveQuotes) startLive();
}

// fetch REAL historical candles for an asset+timeframe and load them into the engine
async function loadRealHistory(assetId) {
  const eng = state.engines[assetId];
  const tf = eng.tfSeconds;
  const isCurrent = () => state.asset.id === assetId && eng.tfSeconds === tf;
  if (isCurrent() && !eng.realHistory) chart.loading = true;   // show loader only until we have data
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`/api/history?asset=${assetId}&tf=${tf}`, { cache: 'no-store' });
      const d = await r.json();
      if (!isCurrent()) return;             // user switched asset/timeframe meanwhile
      if (d.real && d.candles && d.candles.length) {
        eng.loadHistory(d.candles);
        state.trades.filter(t => t.asset === assetId).forEach(t =>
          chart.addMarker({ id: t.id, price: t.entry, dir: t.dir, amount: t.amount }));
        chart.loading = false;
        return;
      }
    } catch (e) { /* retry */ }
    await new Promise(r => setTimeout(r, 600));
  }
  // no real data after retries: last-resort fallback so the chart isn't stuck
  if (isCurrent()) { eng.realHistory = true; chart.loading = false; }
}

let _liveStatus = null;
function startLive() {
  LiveQuotes.start(state.engines, s => {
    const b = $('#liveBadge'); b.className = 'live-badge';
    if (s === 'live') { b.classList.add('live'); $('#liveText').textContent = 'Реальные котировки'; }
    else if (s === 'blocked') { b.classList.add('blocked'); $('#liveText').textContent = 'Симуляция (API недоступен)'; }
    else { $('#liveText').textContent = 'Симуляция'; }
    if (s !== _liveStatus) { _liveStatus = s; renderAssets(); }   // refresh LIVE tags
  });
}

/* ---------- assets ---------- */
function renderAssets() {
  const list = $('#assetList');
  const q = state.search.toLowerCase();
  const items = ASSETS.filter(a => {
    if (state.filter === 'fav') return state.favorites.has(a.id);
    if (state.filter !== 'all' && a.type !== state.filter) return false;
    if (q && !a.name.toLowerCase().includes(q) && !a.id.toLowerCase().includes(q)) return false;
    return true;
  });
  list.innerHTML = items.map(a => {
    const fav = state.favorites.has(a.id);
    const isLive = state.settings.liveQuotes && LiveQuotes.isReal(a.id);
    return `<div class="asset-item ${a.id===state.asset.id?'active':''}" data-id="${a.id}">
      <div class="asset-icon" style="background:${a.color}">${a.abbr || a.name[0]}</div>
      <div class="asset-meta">
        <div class="name">${a.name}${a.otc?' <span style="color:var(--yellow);font-size:9px">OTC</span>':(isLive?' <span style="color:var(--green);font-size:9px">LIVE</span>':'')}</div>
        <div class="type">${a.type}</div>
      </div>
      <div class="asset-payout">
        <div class="pct">${a.payout}%</div>
        <div class="star ${fav?'on':''}" data-fav="${a.id}">${fav?'★':'☆'}</div>
      </div>
    </div>`;
  }).join('') || `<div class="empty-state">Ничего не найдено</div>`;
}

function selectAsset(id) {
  const a = ASSETS.find(x => x.id === id);
  state.asset = a;
  chart.setEngine(state.engines[id]);
  // re-add markers for active trades of this asset
  state.trades.filter(t => t.asset === id).forEach(t =>
    chart.addMarker({ id: t.id, price: t.entry, dir: t.dir, amount: t.amount }));
  $$('.asset-item').forEach(el => el.classList.toggle('active', el.dataset.id === id));
  $('#curIcon').style.background = a.color;
  $('#curIcon').textContent = a.abbr || a.name[0];
  $('#curName').textContent = a.name;
  $('#curSub').textContent = (a.otc ? 'OTC · ' : '') + a.type.toUpperCase() + ' · Payout ' + a.payout + '%';
  updatePayout();
  syncTrigger();
  loadRealHistory(id);
}

/* ---------- times & amount ---------- */
function renderTimes() {
  $('#quickTimes').innerHTML = TIMES.map(t =>
    `<button data-sec="${t.sec}" class="${t.sec===state.expirySec?'active':''}">${t.label}</button>`).join('');
  renderTfMenu();
}
function renderTfMenu() {
  const cur = state.engines[state.asset.id].tfSeconds;
  let html = '', lastG = null;
  TIMEFRAMES.forEach(t => {
    if (t.g !== lastG) { html += `<div class="tf-sec-label">${t.g}</div>`; lastG = t.g; }
    html += `<button data-tf="${t.sec}" class="${t.sec===cur?'active':''}">${t.label}</button>`;
  });
  $('#tfMenu').innerHTML = html;
  const active = TIMEFRAMES.find(t => t.sec === cur) || TIMEFRAMES[0];
  $('#tfLabel').textContent = active.label;
}
function renderAmount() { $('#amountInput').value = state.amount; }
function fmtExpiry(sec) {
  if (sec < 60) return sec + 'с';
  if (sec < 3600) return (sec / 60) + 'м';
  if (sec < 86400) return (sec / 3600) + 'ч';
  if (sec < 604800) return (sec / 86400) + 'д';
  if (sec < 2592000) return (sec / 604800) + 'нед';
  return (sec / 2592000) + 'мес';
}

function updatePayout() {
  const a = state.asset;
  const profit = state.amount * a.payout / 100;
  $('#payoutPct').textContent = '+' + a.payout + '%';
  $('#payoutProfit').textContent = fmtMoney(state.amount + profit);
  $('#btnHigherAmt').textContent = 'Прибыль ' + fmtMoney(profit);
  $('#btnLowerAmt').textContent  = 'Прибыль ' + fmtMoney(profit);
}

function updateBalance() {
  const bal = state.balances[state.account];
  const el = $('#balanceAmount');
  el.textContent = fmtMoney(bal);
  el.className = 'amount ' + state.account;
  $('#balLabel').textContent = state.account === 'demo' ? 'Демо счёт' : 'Реальный счёт';
  $$('.acct-switch button').forEach(b => b.classList.toggle('active', b.dataset.acct === state.account));
  const total = state.wins + state.losses;
  $('#statWins').textContent = state.wins;
  $('#statLosses').textContent = state.losses;
  $('#statWinrate').textContent = total ? Math.round(state.wins/total*100) + '%' : '—';
  $('#statStreak').textContent = (state.streak > 0 ? '+' : '') + state.streak;
  $('#statStreak').className = 'v ' + (state.streak > 0 ? 'up' : (state.streak < 0 ? 'down' : ''));
}

/* ---------- placing trades ---------- */
function placeTrade(dir) {
  const amt = state.amount;
  const bal = state.balances[state.account];
  if (amt < 1) return toast('Ошибка', 'Минимальная ставка $1', 'loss');
  if (amt > bal) return toast('Недостаточно средств', 'На счёте недостаточно средств для этой ставки', 'loss');

  if (state.orderMode === 'pending') return placePending(dir);

  const a = state.asset;
  const entry = state.engines[a.id].price;
  const now = Date.now();
  const trade = mkTrade(a, dir, amt, entry, now);
  state.balances[state.account] -= amt;
  state.trades.push(trade);
  if (a.id === state.asset.id) chart.addMarker({ id: trade.id, price: entry, dir, amount: amt });
  Sound.place();
  updateBalance(); renderTrades(); persist();
  toast(dir === 'higher' ? '▲ Выше' : '▼ Ниже',
    `${a.name} · ${fmtMoney(amt)} · экспирация ${fmtExpiry(state.expirySec)}`, 'info');
}

function mkTrade(a, dir, amt, entry, now, expirySec = state.expirySec) {
  return {
    id: 'T' + now + Math.floor(Math.random()*1000),
    asset: a.id, assetName: a.name, dir, amount: amt, entry, digits: a.digits, payout: a.payout,
    openT: now, expiryT: now + expirySec * 1000, expirySec,
    account: state.account, status: 'active',
  };
}

function placePending(dir) {
  const a = state.asset;
  const trigger = parseFloat($('#triggerInput').value);
  if (!isFinite(trigger) || trigger <= 0) return toast('Ошибка', 'Укажите цену срабатывания', 'loss');
  const cur = state.engines[a.id].price;
  const side = trigger >= cur ? 'above' : 'below';   // wait for price to cross this level
  const amt = state.amount;
  const order = {
    id: 'P' + Date.now() + Math.floor(Math.random()*1000),
    asset: a.id, assetName: a.name, dir, amount: amt, trigger, side, digits: a.digits,
    payout: a.payout, expirySec: state.expirySec, account: state.account,
  };
  state.balances[state.account] -= amt;   // reserve funds
  state.pending.push(order);
  Sound.place();
  updateBalance(); renderTrades(); persist();
  toast('Отложенный ордер', `${a.name} ${dir==='higher'?'▲':'▼'} при ${trigger.toFixed(a.digits)}`, 'info');
}

function checkPending() {
  if (!state.pending.length) return;
  const now = Date.now();
  let fired = false;
  for (const o of state.pending) {
    const price = state.engines[o.asset].price;
    const hit = o.side === 'above' ? price >= o.trigger : price <= o.trigger;
    if (hit) {
      o._fired = true;
      const a = ASSETS.find(x => x.id === o.asset);
      const t = mkTrade(a, o.dir, o.amount, price, now, o.expirySec);
      t.account = o.account;
      state.trades.push(t);
      if (o.asset === state.asset.id) chart.addMarker({ id: t.id, price, dir: o.dir, amount: o.amount });
      Sound.trigger();
      toast('Ордер сработал', `${o.assetName} открыт по ${price.toFixed(o.digits)}`, 'info');
      fired = true;
    }
  }
  if (fired) { state.pending = state.pending.filter(o => !o._fired); renderTrades(); persist(); }
}

function processTrades() {
  checkPending();
  const now = Date.now();
  let changed = false;
  for (const t of state.trades) {
    if (t.status !== 'active') continue;
    if (now >= t.expiryT) {
      const close = state.engines[t.asset].price;
      const tie = Math.abs(close - t.entry) < Math.pow(10, -t.digits) / 2;
      const win = t.dir === 'higher' ? close > t.entry : close < t.entry;
      t.close = close; t.closeT = now;
      t.status = tie ? 'tie' : (win ? 'win' : 'loss');
      if (t.status === 'win') {
        const profit = t.amount * t.payout / 100;
        state.balances[t.account] += t.amount + profit; t.profit = profit;
        state.wins++; state.streak = state.streak >= 0 ? state.streak + 1 : 1;
        state.bestStreak = Math.max(state.bestStreak, state.streak);
        Sound.win(); chart.flash('+' + fmtMoney(profit), '#21c17a');
        toast('Победа! +' + fmtMoney(profit), `${t.assetName} закрылась в вашу пользу`, 'win');
      } else if (t.status === 'tie') {
        state.balances[t.account] += t.amount; t.profit = 0;
        Sound.tie(); chart.flash('Возврат', '#f5b93b');
        toast('Возврат', `${t.assetName}: цена не изменилась`, 'info');
      } else {
        t.profit = -t.amount; state.losses++; state.streak = state.streak <= 0 ? state.streak - 1 : -1;
        Sound.loss(); chart.flash('−' + fmtMoney(t.amount), '#f0435b');
        toast('Проигрыш −' + fmtMoney(t.amount), `${t.assetName} закрылась против вас`, 'loss');
      }
      chart.removeMarker(t.id);
      state.history.unshift(t);
      changed = true;
    }
  }
  if (changed) { state.trades = state.trades.filter(t => t.status === 'active'); updateBalance(); persist(); }
  renderTrades();
}

/* ---------- trades UI ---------- */
function renderTrades() {
  $('#activeBadge').textContent = state.trades.length || '';
  $('#activeBadge').style.display = state.trades.length ? 'inline-block' : 'none';
  $('#pendingBadge').textContent = state.pending.length || '';
  $('#pendingBadge').style.display = state.pending.length ? 'inline-block' : 'none';

  const body = $('#tradesBody'), now = Date.now();
  if (state.tradesTab === 'active') {
    if (!state.trades.length) { body.innerHTML = `<div class="empty-state">Нет открытых сделок. Сделайте ставку ▲ или ▼</div>`; return; }
    body.innerHTML = state.trades.map(t => {
      const eng = state.engines[t.asset];
      const remain = Math.max(0, Math.ceil((t.expiryT - now) / 1000));
      const winning = t.dir === 'higher' ? eng.price > t.entry : eng.price < t.entry;
      return `<div class="trade-row">
        <div class="dir ${t.dir}">${t.dir==='higher'?'▲':'▼'}</div>
        <div><div class="t-name">${t.assetName}</div><div class="t-sub">вход ${t.entry.toFixed(t.digits)}</div></div>
        <div class="mono">${fmtMoney(t.amount)}</div>
        <div class="mono ${winning?'up':'down'}">${eng.price.toFixed(t.digits)}</div>
        <div class="${winning?'t-result win':'t-result loss'}">${winning?'+'+fmtMoney(t.amount*t.payout/100):'−'+fmtMoney(t.amount)}</div>
        <div class="t-timer">${fmtClock(remain)}</div>
      </div>`;
    }).join('');
  } else if (state.tradesTab === 'pending') {
    if (!state.pending.length) { body.innerHTML = `<div class="empty-state">Нет отложенных ордеров</div>`; return; }
    body.innerHTML = state.pending.map(o => {
      const eng = state.engines[o.asset];
      return `<div class="trade-row">
        <div class="dir ${o.dir}">${o.dir==='higher'?'▲':'▼'}</div>
        <div><div class="t-name">${o.assetName}</div><div class="t-sub">при ${o.trigger.toFixed(o.digits)} (${o.side==='above'?'↑':'↓'})</div></div>
        <div class="mono">${fmtMoney(o.amount)}</div>
        <div class="mono">${eng.price.toFixed(o.digits)}</div>
        <div class="t-sub">${fmtExpiry(o.expirySec)}</div>
        <div><button class="cancel-order" data-cancel="${o.id}">✕ Отмена</button></div>
      </div>`;
    }).join('');
  } else {
    if (!state.history.length) { body.innerHTML = `<div class="empty-state">История сделок пуста</div>`; return; }
    body.innerHTML = state.history.slice(0, 80).map(t => {
      const res = t.status === 'win' ? 'win' : (t.status==='tie' ? '' : 'loss');
      const resText = t.status === 'win' ? '+'+fmtMoney(t.profit) : (t.status==='tie' ? 'Возврат' : '−'+fmtMoney(t.amount));
      return `<div class="trade-row">
        <div class="dir ${t.dir}">${t.dir==='higher'?'▲':'▼'}</div>
        <div><div class="t-name">${t.assetName}</div><div class="t-sub">${new Date(t.closeT).toLocaleTimeString('ru-RU')}</div></div>
        <div class="mono">${fmtMoney(t.amount)}</div>
        <div class="mono">${t.entry.toFixed(t.digits)} → ${t.close.toFixed(t.digits)}</div>
        <div class="t-result ${res}">${resText}</div>
        <div class="t-sub">${fmtExpiry(t.expirySec)}</div>
      </div>`;
    }).join('');
  }
}
function fmtClock(sec) {
  if (sec >= 86400) { const d = Math.floor(sec/86400), h = Math.floor((sec%86400)/3600); return `${d}д ${h}ч`; }
  if (sec >= 3600) { const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60); return `${h}ч ${m}м`; }
  const m = Math.floor(sec/60), s = sec%60; return `${m}:${String(s).padStart(2,'0')}`;
}

/* ---------- ticks / topbar ---------- */
function tickAll() {
  ASSETS.forEach(a => state.engines[a.id].tick());
  const eng = state.engines[state.asset.id];
  const first = eng.candles[Math.max(0, eng.candles.length - 70)].o;
  const chg = eng.price - first, chgPct = chg / first * 100, up = chg >= 0;
  $('#curPrice').textContent = eng.fmt(eng.price);
  $('#curPrice').className = 'p ' + (up ? 'up' : 'down');
  $('#curChg').textContent = (up?'▲ +':'▼ ') + eng.fmt(Math.abs(chg)) + ' (' + (up?'+':'') + chgPct.toFixed(2) + '%)';
  $('#curChg').className = 'chg ' + (up ? 'up' : 'down');
  const c = eng.current;
  $('#hudO').textContent = eng.fmt(c.o); $('#hudH').textContent = eng.fmt(c.h);
  $('#hudL').textContent = eng.fmt(c.l); $('#hudC').textContent = eng.fmt(c.c);
  if (state.orderMode === 'pending') $('#curPriceHint').textContent = 'сейчас ' + eng.fmt(eng.price);
}
function loop() {
  chart.draw();
  const btn = $('#chartToNow'); if (btn) btn.hidden = chart.offset === 0;
  requestAnimationFrame(loop);
}

/* ---------- toast ---------- */
function toast(title, desc, kind='') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = `<div class="tt">${title}</div><div class="td">${desc}</div>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity='0'; el.style.transform='translateX(30px)'; el.style.transition='.3s'; }, 3200);
  setTimeout(() => el.remove(), 3600);
}

/* ---------- trigger stepper sync ---------- */
function syncTrigger() {
  const p = state.engines[state.asset.id].price;
  $('#triggerInput').value = p.toFixed(state.asset.digits);
}
function triggerStep() { return state.asset.vol * 8; }

/* ---------- mobile drawer ---------- */
function openDrawer(v) {
  $('.sidebar').classList.toggle('open', v);
  $('#drawerOverlay').classList.toggle('open', v);
}

/* ---------- UI bindings ---------- */
function bindUI() {
  // mobile asset drawer
  $('#menuBtn').addEventListener('click', () => openDrawer(!$('.sidebar').classList.contains('open')));
  $('#drawerOverlay').addEventListener('click', () => openDrawer(false));

  $('#assetList').addEventListener('click', e => {
    const fav = e.target.closest('[data-fav]');
    if (fav) { e.stopPropagation();
      const id = fav.dataset.fav;
      state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id);
      renderAssets(); persist(); return;
    }
    const item = e.target.closest('.asset-item');
    if (item) { selectAsset(item.dataset.id); openDrawer(false); }
  });
  $('#assetSearch').addEventListener('input', e => { state.search = e.target.value; renderAssets(); });
  $$('.asset-tabs button').forEach(b => b.addEventListener('click', () => {
    $$('.asset-tabs button').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); state.filter = b.dataset.filter; renderAssets();
  }));

  // amount
  $('#amtMinus').addEventListener('click', () => setAmount(state.amount - amtStep()));
  $('#amtPlus').addEventListener('click', () => setAmount(state.amount + amtStep()));
  $('#amountInput').addEventListener('change', e => setAmount(parseFloat(e.target.value) || 1));
  $$('#quickAmts button').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.set) setAmount(parseFloat(b.dataset.set));
    else if (b.dataset.mul === 'x2') setAmount(state.amount * 2);
    else if (b.dataset.mul === 'half') setAmount(state.amount / 2);
  }));

  // trigger stepper
  $('#triggerMinus').addEventListener('click', () => { $('#triggerInput').value = (parseFloat($('#triggerInput').value) - triggerStep()).toFixed(state.asset.digits); });
  $('#triggerPlus').addEventListener('click', () => { $('#triggerInput').value = (parseFloat($('#triggerInput').value) + triggerStep()).toFixed(state.asset.digits); });

  // times
  $('#quickTimes').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    state.expirySec = parseInt(b.dataset.sec);
    $$('#quickTimes button').forEach(x => x.classList.toggle('active', x === b));
  });

  // order mode
  $('#orderMode').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    state.orderMode = b.dataset.mode;
    $$('#orderMode button').forEach(x => x.classList.toggle('active', x === b));
    $('#pendingPriceBlock').style.display = state.orderMode === 'pending' ? 'block' : 'none';
    if (state.orderMode === 'pending') syncTrigger();
  });

  // timeframe / chart type / indicators / zoom
  $('#tfCurrent').addEventListener('click', e => { e.stopPropagation(); $('#tfMenu').classList.toggle('open'); });
  document.addEventListener('click', () => $('#tfMenu').classList.remove('open'));
  $('#tfMenu').addEventListener('click', e => {
    const b = e.target.closest('button[data-tf]'); if (!b) return;
    const sec = parseInt(b.dataset.tf);
    if (sec !== state.engines[state.asset.id].tfSeconds) {
      ASSETS.forEach(a => state.engines[a.id].setTf(sec));
      loadRealHistory(state.asset.id);
    }
    renderTfMenu();
    $('#tfMenu').classList.remove('open');
  });
  $$('#chartTypeGroup button').forEach(b => b.addEventListener('click', () => {
    $$('#chartTypeGroup button').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); chart.type = b.dataset.type;
  }));
  $('#indSma').addEventListener('click', () => toggleInd('sma', '#indSma'));
  $('#indEma').addEventListener('click', () => toggleInd('ema', '#indEma'));
  $('#indBb').addEventListener('click', () => toggleInd('bb', '#indBb'));
  $('#zoomIn').addEventListener('click', () => chart.zoom(-12));
  $('#zoomOut').addEventListener('click', () => chart.zoom(12));
  $('#indVol').addEventListener('click', () => { chart.indicators.vol = !chart.indicators.vol; $('#indVol').classList.toggle('on', chart.indicators.vol); });
  // RSI / MACD — one oscillator panel, mutually exclusive
  $('#indRsi').addEventListener('click', () => {
    chart.indicators.rsi = !chart.indicators.rsi; if (chart.indicators.rsi) chart.indicators.macd = false;
    $('#indRsi').classList.toggle('on', chart.indicators.rsi); $('#indMacd').classList.toggle('on', chart.indicators.macd);
  });
  $('#indMacd').addEventListener('click', () => {
    chart.indicators.macd = !chart.indicators.macd; if (chart.indicators.macd) chart.indicators.rsi = false;
    $('#indMacd').classList.toggle('on', chart.indicators.macd); $('#indRsi').classList.toggle('on', chart.indicators.rsi);
  });
  // drawing tools
  const syncTools = () => { $('#toolTrend').classList.toggle('on', chart.tool === 'trend'); $('#toolHLine').classList.toggle('on', chart.tool === 'hline'); };
  $('#toolTrend').addEventListener('click', () => { chart.setTool('trend'); syncTools(); });
  $('#toolHLine').addEventListener('click', () => { chart.setTool('hline'); syncTools(); });
  $('#toolClear').addEventListener('click', () => { chart.clearDrawings(); chart.tool = null; syncTools(); });
  $('#chartToNow').addEventListener('click', () => chart.toNow());

  // trade buttons
  $('#btnHigher').addEventListener('click', () => placeTrade('higher'));
  $('#btnLower').addEventListener('click', () => placeTrade('lower'));

  // cancel pending
  $('#tradesBody').addEventListener('click', e => {
    const c = e.target.closest('[data-cancel]'); if (!c) return;
    const o = state.pending.find(x => x.id === c.dataset.cancel);
    if (o) { state.balances[o.account] += o.amount; state.pending = state.pending.filter(x => x.id !== o.id);
      updateBalance(); renderTrades(); persist(); toast('Ордер отменён', o.assetName + ' — средства возвращены', 'info'); }
  });

  // trades tabs
  $$('.trades-tabs button').forEach(b => b.addEventListener('click', () => {
    $$('.trades-tabs button').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); state.tradesTab = b.dataset.tab; renderTrades();
  }));

  // account switch (Демо / Реальный)
  $$('.acct-switch button').forEach(b => b.addEventListener('click', () => {
    state.account = b.dataset.acct; updateBalance(); updatePayout(); persist();
  }));

  // deposit — tops up the REAL account with notional funds (no real payment)
  $('#btnDeposit').addEventListener('click', () => $('#depositModal').classList.add('open'));
  $('#depositClose').addEventListener('click', () => $('#depositModal').classList.remove('open'));
  $('#depositModal').addEventListener('click', e => { if (e.target.id === 'depositModal') e.currentTarget.classList.remove('open'); });
  $$('#depositAmts button').forEach(b => b.addEventListener('click', () => $('#depositInput').value = b.dataset.amt));
  $('#depositConfirm').addEventListener('click', () => {
    const v = parseFloat($('#depositInput').value) || 0;
    if (v <= 0) return;
    state.balances.real += v; state.account = 'real';
    updateBalance(); updatePayout(); persist();
    $('#depositModal').classList.remove('open');
    toast('Счёт пополнен', fmtMoney(v) + ' зачислено на реальный счёт', 'win');
  });

  // live quotes toggle (click badge to switch real <-> simulation)
  $('#liveBadge').addEventListener('click', () => {
    state.settings.liveQuotes = !state.settings.liveQuotes;
    if (state.settings.liveQuotes) startLive();
    else { LiveQuotes.stop(); toast('Симуляция', 'Реальные котировки отключены', 'info'); }
    renderAssets(); persist();
  });

  // user menu
  $('#userAvatar').addEventListener('click', e => { e.stopPropagation(); $('#userDropdown').classList.toggle('open'); });
  document.addEventListener('click', () => $('#userDropdown').classList.remove('open'));
  $('#userDropdown').addEventListener('click', e => e.stopPropagation());
  $('#udLogout').addEventListener('click', async () => { await persist(); await Store.logout(); location.href = 'index.html'; });

  // keyboard
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowUp') { e.preventDefault(); placeTrade('higher'); }
    if (e.key === 'ArrowDown') { e.preventDefault(); placeTrade('lower'); }
  });

  // save on exit
  window.addEventListener('beforeunload', persist);
}

function amtStep() { return state.amount >= 100 ? 10 : (state.amount >= 20 ? 5 : 1); }
function setAmount(v) { state.amount = Math.max(1, Math.round(v * 100) / 100); renderAmount(); updatePayout(); }
function toggleInd(key, sel) { chart.indicators[key] = !chart.indicators[key]; $(sel).classList.toggle('on', chart.indicators[key]); }

async function boot() {
  const saved = await Store.loadState();
  if (!saved) { location.href = 'index.html'; return; }   // session expired
  buildState(saved);
  init();
}
if (_user) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}
