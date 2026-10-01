/* ===== Storage: backend-first (SQLite via API) with localStorage fallback =====
   currentUser() is synchronous (reads a cached user) so page guards work instantly.
   register/login/loadState/saveState are async and hit the backend when available. */
const Store = (() => {
  const USER_KEY = 'pt_user';
  const LUSERS = 'pt_users';        // fallback local user table
  const LPREFIX = 'pt_state_';

  function rd(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function wr(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function cacheUser(u) { u ? wr(USER_KEY, u) : del(USER_KEY); }
  function isNetErr(e) { return !(e && e.status); }   // fetch threw -> backend unreachable

  function lhash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); }

  function freshState() {
    return {
      account: 'demo', balances: { demo: 30000, real: 0 },
      history: [], trades: [], pending: [],
      favorites: ['EURUSD', 'BTCUSD'],
      wins: 0, losses: 0, ties: 0, bestStreak: 0,
      settings: { sound: true, liveQuotes: true },
    };
  }
  function clean(state) {
    return {
      account: state.account, balances: state.balances,
      history: (state.history || []).slice(0, 100),
      trades: state.trades || [], pending: state.pending || [],
      favorites: Array.from(state.favorites || []),
      wins: state.wins, losses: state.losses, ties: state.ties,
      bestStreak: state.bestStreak, settings: state.settings,
    };
  }

  /* ---------- local fallback ---------- */
  const Local = {
    users: () => rd(LUSERS, {}),
    register(email, pw, name) {
      email = (email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Некорректный email' };
      if (pw.length < 4) return { ok: false, error: 'Пароль минимум 4 символа' };
      const u = Local.users();
      if (u[email]) return { ok: false, error: 'Такой пользователь уже существует' };
      u[email] = { email, name: name || email.split('@')[0], pass: lhash(pw), created: Date.now() };
      wr(LUSERS, u); wr(LPREFIX + email, freshState());
      cacheUser({ email, name: u[email].name, guest: false }); return { ok: true };
    },
    login(email, pw) {
      email = (email || '').trim().toLowerCase();
      const u = Local.users()[email];
      if (!u || u.pass !== lhash(pw)) return { ok: false, error: 'Неверный email или пароль' };
      cacheUser({ email, name: u.name, guest: false }); return { ok: true };
    },
    guest() {
      const email = 'guest_' + Math.random().toString(16).slice(2, 8);
      const u = Local.users(); u[email] = { email, name: 'Гость', pass: '', created: Date.now(), guest: true };
      wr(LUSERS, u); wr(LPREFIX + email, freshState());
      cacheUser({ email, name: 'Гость', guest: true }); return { ok: true };
    },
    load(email) { return Object.assign(freshState(), rd(LPREFIX + email, {})); },
    save(email, state) { wr(LPREFIX + email, clean(state)); },
  };

  return {
    freshState,
    currentUser() { return rd(USER_KEY, null); },
    currentEmail() { const u = rd(USER_KEY, null); return u ? u.email : null; },

    async register(email, password, name, ref) {
      try {
        const r = await API.post('/api/register', { email, password, name, ref });
        API.setToken(r.token); cacheUser(r.user); return { ok: true };
      } catch (e) {
        if (isNetErr(e)) return Local.register(email, password, name);
        return { ok: false, error: e.message };
      }
    },
    async referrals() {
      try { return await API.get('/api/referrals'); } catch (e) { return null; }
    },
    async login(email, password) {
      try {
        const r = await API.post('/api/login', { email, password });
        API.setToken(r.token); cacheUser(r.user); return { ok: true };
      } catch (e) {
        if (isNetErr(e)) return Local.login(email, password);
        return { ok: false, error: e.message };
      }
    },
    async loginGuest() {
      try {
        const r = await API.post('/api/guest', {});
        API.setToken(r.token); cacheUser(r.user); return { ok: true };
      } catch (e) {
        if (isNetErr(e)) return Local.guest();
        return { ok: false, error: e.message };
      }
    },
    async loadState() {
      try {
        const r = await API.get('/api/me');
        if (r.user) cacheUser(r.user);
        return Object.assign(freshState(), r.state || {});
      } catch (e) {
        if (e && e.status === 401) { this.logoutLocal(); return null; }  // token dead
        return Local.load(this.currentEmail());                          // offline
      }
    },
    async saveState(_ignored, state) {
      const payload = clean(state);
      wr(LPREFIX + this.currentEmail(), payload);   // always cache
      try { await API.post('/api/state', { state: payload }); } catch (e) { /* offline: cache only */ }
    },
    async updateProfile(fields) {
      // fields: { name?, avatar? }
      try { const r = await API.post('/api/profile', fields); cacheUser(r.user); return r.user; }
      catch (e) { const u = this.currentUser(); if (u) { Object.assign(u, fields); cacheUser(u); } return u; }
    },
    async changePassword(oldPassword, newPassword) {
      try { await API.post('/api/password', { oldPassword, newPassword }); return { ok: true }; }
      catch (e) { return { ok: false, error: (e && e.status) ? e.message : 'Сервер недоступен' }; }
    },
    async leaderboard() {
      try { return await API.get('/api/leaderboard'); } catch (e) { return []; }
    },
    logoutLocal() { API.setToken(''); cacheUser(null); },
    async logout() { try { await API.post('/api/logout', {}); } catch (e) {} this.logoutLocal(); },
  };
})();
