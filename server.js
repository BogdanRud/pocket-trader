// Pocket Trader backend — Node.js + Express + built-in SQLite (node:sqlite).
// Run:  node server.js   (serves the whole site on http://localhost:8123)
'use strict';
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PORT = process.env.PORT || 8123;

// ------------------------------------------------------------ database
const db = new DatabaseSync(path.join(ROOT, 'pt.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS users(
    email TEXT PRIMARY KEY, name TEXT, pass TEXT, salt TEXT, created INTEGER, guest INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS states(email TEXT PRIMARY KEY, json TEXT, updated INTEGER);
  CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, email TEXT, created INTEGER);
`);
try { db.exec('ALTER TABLE users ADD COLUMN avatar TEXT'); } catch (e) { /* exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN ref_code TEXT'); } catch (e) { /* exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN ref_by TEXT'); } catch (e) { /* exists */ }
const REF_RATE = 0.10;   // referrer earns this share of referred users' trade turnover

const hashPw = (pw, salt) => crypto.pbkdf2Sync(pw, salt, 100000, 32, 'sha256').toString('hex');
const now = () => Math.floor(Date.now() / 1000);

const START_BALANCE = 30000;   // every new account starts with this; no top-ups/resets
function freshState() {
  return {
    account: 'demo', balances: { demo: START_BALANCE, real: 0 },
    history: [], trades: [], pending: [],
    favorites: ['EURUSD', 'BTCUSD'],
    wins: 0, losses: 0, ties: 0, bestStreak: 0,
    settings: { sound: true, liveQuotes: true },
  };
}
function userPublic(email) {
  const r = db.prepare('SELECT email,name,guest,created,avatar FROM users WHERE email=?').get(email);
  if (!r) return null;
  return { email: r.email, name: r.name, guest: !!r.guest, created: r.created, avatar: r.avatar || '' };
}
function newSession(email) {
  const tok = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions(token,email,created) VALUES(?,?,?)').run(tok, email, now());
  return tok;
}

// ------------------------------------------------------------ price poller
const ASSET_SRC = {
  // forex — Yahoo real rates; EUR/USD via Binance (liquid EURUSDT) for clean candles
  EURUSD: ['binance', 'EURUSDT'],
  GBPUSD: ['yahoo', 'GBPUSD=X'], USDJPY: ['yahoo', 'USDJPY=X'], USDCHF: ['yahoo', 'USDCHF=X'],
  USDCAD: ['yahoo', 'USDCAD=X'], AUDUSD: ['yahoo', 'AUDUSD=X'], NZDUSD: ['yahoo', 'NZDUSD=X'],
  EURGBP: ['yahoo', 'EURGBP=X'], EURJPY: ['yahoo', 'EURJPY=X'], GBPJPY: ['yahoo', 'GBPJPY=X'],
  EURCHF: ['yahoo', 'EURCHF=X'], AUDJPY: ['yahoo', 'AUDJPY=X'], CADJPY: ['yahoo', 'CADJPY=X'],
  CHFJPY: ['yahoo', 'CHFJPY=X'], NZDJPY: ['yahoo', 'NZDJPY=X'], EURCAD: ['yahoo', 'EURCAD=X'],
  EURAUD: ['yahoo', 'EURAUD=X'], GBPCHF: ['yahoo', 'GBPCHF=X'], GBPCAD: ['yahoo', 'GBPCAD=X'],
  AUDCAD: ['yahoo', 'AUDCAD=X'], AUDNZD: ['yahoo', 'AUDNZD=X'],
  // crypto — Binance
  BTCUSD: ['binance', 'BTCUSDT'], ETHUSD: ['binance', 'ETHUSDT'], SOLUSD: ['binance', 'SOLUSDT'],
  BNBUSD: ['binance', 'BNBUSDT'], XRPUSD: ['binance', 'XRPUSDT'], ADAUSD: ['binance', 'ADAUSDT'],
  DOGEUSD: ['binance', 'DOGEUSDT'], LTCUSD: ['binance', 'LTCUSDT'],
  // metals / stocks / indices — Yahoo
  XAUUSD: ['yahoo', 'GC=F'], XAGUSD: ['yahoo', 'SI=F'],
  AAPL: ['yahoo', 'AAPL'], TSLA: ['yahoo', 'TSLA'], MSFT: ['yahoo', 'MSFT'],
  AMZN: ['yahoo', 'AMZN'], NVDA: ['yahoo', 'NVDA'],
  SP500: ['yahoo', '^GSPC'], NAS100: ['yahoo', '^NDX'], DJI: ['yahoo', '^DJI'],
};
const PRICES = {};

async function pollBinance() {
  try {
    const syms = Object.values(ASSET_SRC).filter(v => v[0] === 'binance').map(v => v[1]);
    const url = 'https://api.binance.com/api/v3/ticker/price?symbols=' + encodeURIComponent(JSON.stringify(syms));
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const data = await r.json();
    const m = Object.fromEntries(data.map(d => [d.symbol, parseFloat(d.price)]));
    for (const [k, [src, sym]] of Object.entries(ASSET_SRC))
      if (src === 'binance' && m[sym]) PRICES[k] = { price: m[sym], real: true, ts: Date.now() / 1000 };
  } catch (e) { /* keep last; frontend simulates */ }
}
async function pollYahoo() {
  const jobs = Object.entries(ASSET_SRC).filter(([, v]) => v[0] === 'yahoo').map(async ([k, [, sym]]) => {
    try {
      const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?range=1d&interval=1m';
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const data = await r.json();
      const p = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (p) PRICES[k] = { price: parseFloat(p), real: true, ts: Date.now() / 1000 };
    } catch (e) { /* ignore */ }
  });
  await Promise.all(jobs);
}
async function pollLoop() {
  let i = 0;
  // prime immediately
  await pollBinance(); await pollYahoo();
  setInterval(async () => { await pollBinance(); if (i % 4 === 0) await pollYahoo(); i++; }, 5000);
}

// ------------------------------------------------------------ real historical candles
// tf seconds -> [binance interval, aggregate count]
const BINANCE_TF = {
  5:['1s',5], 10:['1s',10], 15:['1s',15], 30:['1s',30],
  60:['1m',1], 120:['1m',2], 180:['3m',1], 300:['5m',1],
  900:['15m',1], 1800:['30m',1], 3600:['1h',1], 14400:['4h',1],
  86400:['1d',1], 604800:['1w',1], 2592000:['1M',1], 31536000:['1M',12],
};
// tf seconds -> [yahoo interval, range, aggregate count]  (no sub-minute on yahoo)
const YAHOO_TF = {
  60:['1m','1d',1], 120:['2m','5d',1], 180:['1m','5d',3], 300:['5m','5d',1],
  900:['15m','1mo',1], 1800:['30m','1mo',1], 3600:['60m','3mo',1], 14400:['1h','6mo',4],
  86400:['1d','2y',1], 604800:['1wk','10y',1], 2592000:['1mo','max',1], 31536000:['3mo','max',4],
};

function aggregate(raw, n) {
  if (n <= 1) return raw;
  const out = [];
  for (let i = 0; i < raw.length; i += n) {
    const g = raw.slice(i, i + n); if (!g.length) continue;
    out.push({ t: g[0].t, o: g[0].o, h: Math.max(...g.map(x => x.h)),
      l: Math.min(...g.map(x => x.l)), c: g[g.length - 1].c, v: g.reduce((s, x) => s + x.v, 0) });
  }
  return out;
}

async function binanceHistory(symbol, tf) {
  const m = BINANCE_TF[tf]; if (!m) return null;
  const [interval, agg] = m;
  const limit = Math.min(1000, 500 * agg);
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const data = await r.json();
  if (!Array.isArray(data)) return null;
  const raw = data.map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
  return aggregate(raw, agg).slice(-500);
}

async function yahooHistory(symbol, tf) {
  const m = YAHOO_TF[tf]; if (!m) return null;   // sub-minute -> no data
  const [interval, range, agg] = m;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const data = await r.json();
  const res = data && data.chart && data.chart.result && data.chart.result[0];
  if (!res || !res.timestamp) return null;
  const ts = res.timestamp, q = (res.indicators.quote && res.indicators.quote[0]) || {};
  const raw = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.open[i] == null || q.close[i] == null) continue;
    raw.push({ t: ts[i] * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume ? (q.volume[i] || 0) : 0 });
  }
  return aggregate(raw, agg).slice(-500);
}

// ------------------------------------------------------------ express app
const app = express();
app.use(express.json({ limit: '1mb' }));

// never serve server internals / the db file
app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  if (p.endsWith('.db') || p === '/server.js' || p === '/server.py' ||
      p === '/package.json' || p === '/package-lock.json' || p.startsWith('/node_modules')) {
    return res.status(404).json({ error: 'not found' });
  }
  next();
});

function authEmail(req) {
  const tok = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!tok) return null;
  const r = db.prepare('SELECT email FROM sessions WHERE token=?').get(tok);
  return r ? r.email : null;
}

app.get('/api/prices', (req, res) => res.json(PRICES));

app.get('/api/history', async (req, res) => {
  const asset = req.query.asset, tf = parseInt(req.query.tf);
  const src = ASSET_SRC[asset];
  if (!src || !tf) return res.json({ candles: [], real: false });
  try {
    const candles = src[0] === 'binance' ? await binanceHistory(src[1], tf) : await yahooHistory(src[1], tf);
    res.json({ candles: candles || [], real: !!(candles && candles.length) });
  } catch (e) { res.json({ candles: [], real: false }); }
});

app.get('/api/me', (req, res) => {
  const email = authEmail(req);
  if (!email) return res.status(401).json({ error: 'unauthorized' });
  const r = db.prepare('SELECT json FROM states WHERE email=?').get(email);
  const state = r ? JSON.parse(r.json) : freshState();
  res.json({ user: userPublic(email), state });
});

app.get('/api/leaderboard', (req, res) => {
  const rows = db.prepare('SELECT s.email,u.name,u.guest,s.json FROM states s JOIN users u ON u.email=s.email').all();
  const board = [];
  for (const r of rows) {
    try {
      const st = JSON.parse(r.json);
      const demo = Number(st.balances?.demo || 0);
      const wins = Number(st.wins || 0), losses = Number(st.losses || 0), total = wins + losses;
      board.push({ name: r.name || 'trader', guest: !!r.guest, balance: Math.round(demo * 100) / 100,
        wins, losses, winrate: total ? Math.round(wins / total * 100) : 0, trades: total });
    } catch (e) {}
  }
  board.sort((a, b) => b.balance - a.balance);
  res.json(board.slice(0, 20));
});

app.post('/api/register', (req, res) => {
  let { email, password, name } = req.body || {};
  email = (email || '').trim().toLowerCase();
  name = (name || '').trim() || (email ? email.split('@')[0] : 'trader');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Некорректный email' });
  if (!password || password.length < 4) return res.status(400).json({ error: 'Пароль минимум 4 символа' });
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email))
    return res.status(409).json({ error: 'Такой пользователь уже существует' });
  const salt = crypto.randomBytes(8).toString('hex');
  const refCode = crypto.randomBytes(4).toString('hex');   // this user's own referral code
  // resolve who invited this user (optional ?ref code)
  let refBy = null;
  const inviteCode = (req.body && req.body.ref || '').trim().toLowerCase();
  if (inviteCode) {
    const r = db.prepare('SELECT email FROM users WHERE ref_code=?').get(inviteCode);
    if (r) refBy = r.email;
  }
  db.prepare('INSERT INTO users(email,name,pass,salt,created,guest,ref_code,ref_by) VALUES(?,?,?,?,?,0,?,?)')
    .run(email, name, hashPw(password, salt), salt, now(), refCode, refBy);
  db.prepare('INSERT INTO states(email,json,updated) VALUES(?,?,?)').run(email, JSON.stringify(freshState()), now());
  // referral commission accrues from the invited user's turnover (see /api/referrals)
  res.json({ token: newSession(email), user: userPublic(email) });
});

app.get('/api/referrals', (req, res) => {
  const email = authEmail(req);
  if (!email) return res.status(401).json({ error: 'unauthorized' });
  let r = db.prepare('SELECT ref_code FROM users WHERE email=?').get(email);
  let code = r && r.ref_code;
  if (!code) { code = crypto.randomBytes(4).toString('hex'); db.prepare('UPDATE users SET ref_code=? WHERE email=?').run(code, email); }

  // sum the trade turnover (total staked) of everyone this user invited
  const invited = db.prepare('SELECT email FROM users WHERE ref_by=?').all(email);
  let turnover = 0;
  for (const u of invited) {
    const s = db.prepare('SELECT json FROM states WHERE email=?').get(u.email);
    if (!s) continue;
    try { const st = JSON.parse(s.json); (st.history || []).forEach(t => { turnover += Math.abs(t.amount || 0); }); } catch (e) {}
  }
  const earned = Math.round(turnover * REF_RATE * 100) / 100;

  // credit the difference since last time to the referrer's real balance (idempotent)
  const ms = db.prepare('SELECT json FROM states WHERE email=?').get(email);
  if (ms) {
    try {
      const st = JSON.parse(ms.json);
      const paid = st.refPaid || 0;
      if (earned > paid) { st.balances = st.balances || { demo: 0, real: 0 }; st.balances.real = (st.balances.real || 0) + (earned - paid); st.refPaid = earned; db.prepare('UPDATE states SET json=? WHERE email=?').run(JSON.stringify(st), email); }
    } catch (e) {}
  }
  res.json({ code, count: invited.length, turnover: Math.round(turnover * 100) / 100, rate: REF_RATE * 100, earned });
});

app.post('/api/login', (req, res) => {
  let { email, password } = req.body || {};
  email = (email || '').trim().toLowerCase();
  const r = db.prepare('SELECT pass,salt FROM users WHERE email=?').get(email);
  if (!r || r.pass !== hashPw(password || '', r.salt))
    return res.status(401).json({ error: 'Неверный email или пароль' });
  res.json({ token: newSession(email), user: userPublic(email) });
});

app.post('/api/guest', (req, res) => {
  const email = 'guest_' + crypto.randomBytes(4).toString('hex');
  db.prepare('INSERT INTO users(email,name,pass,salt,created,guest) VALUES(?,?,?,?,?,1)')
    .run(email, 'Гость', '', '', now());
  db.prepare('INSERT INTO states(email,json,updated) VALUES(?,?,?)').run(email, JSON.stringify(freshState()), now());
  res.json({ token: newSession(email), user: userPublic(email) });
});

app.post('/api/state', (req, res) => {
  const email = authEmail(req);
  if (!email) return res.status(401).json({ error: 'unauthorized' });
  const state = req.body && req.body.state;
  if (!state || typeof state !== 'object') return res.status(400).json({ error: 'bad state' });
  db.prepare('INSERT INTO states(email,json,updated) VALUES(?,?,?) ' +
             'ON CONFLICT(email) DO UPDATE SET json=excluded.json, updated=excluded.updated')
    .run(email, JSON.stringify(state), now());
  res.json({ ok: true });
});

app.post('/api/profile', (req, res) => {
  const email = authEmail(req);
  if (!email) return res.status(401).json({ error: 'unauthorized' });
  const name = (req.body?.name || '').trim();
  const avatar = (req.body?.avatar || '').slice(0, 300000);   // emoji, or a small photo data URL
  if (name) db.prepare('UPDATE users SET name=? WHERE email=?').run(name, email);
  if (req.body && 'avatar' in req.body) db.prepare('UPDATE users SET avatar=? WHERE email=?').run(avatar, email);
  res.json({ user: userPublic(email) });
});

app.post('/api/password', (req, res) => {
  const email = authEmail(req);
  if (!email) return res.status(401).json({ error: 'unauthorized' });
  const { oldPassword, newPassword } = req.body || {};
  const r = db.prepare('SELECT pass,salt,guest FROM users WHERE email=?').get(email);
  if (!r) return res.status(404).json({ error: 'no user' });
  if (r.guest) return res.status(400).json({ error: 'Гость не может менять пароль' });
  if (r.pass !== hashPw(oldPassword || '', r.salt)) return res.status(401).json({ error: 'Неверный текущий пароль' });
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'Новый пароль минимум 4 символа' });
  const salt = crypto.randomBytes(8).toString('hex');
  db.prepare('UPDATE users SET pass=?, salt=? WHERE email=?').run(hashPw(newPassword, salt), salt, email);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const tok = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (tok) db.prepare('DELETE FROM sessions WHERE token=?').run(tok);
  res.json({ ok: true });
});

// static site — no-cache so browsers always pick up the latest code
app.use(express.static(ROOT, {
  extensions: ['html'],
  etag: true,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));

pollLoop();
app.listen(PORT, () => {
  console.log(`Pocket Trader (Node) running:  http://localhost:${PORT}`);
  console.log('  API: /api/prices  /api/register  /api/login  /api/me  /api/state  /api/leaderboard');
});
