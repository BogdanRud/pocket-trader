/* ===== Backend API client ===== */
const API = (() => {
  const TOKEN_KEY = 'pt_token';
  function token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {} }

  async function req(method, path, body) {
    const opt = { method, headers: {} };
    if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const t = token(); if (t) opt.headers['Authorization'] = 'Bearer ' + t;
    const r = await fetch(path, opt);
    let data = {};
    try { data = await r.json(); } catch (e) {}
    if (!r.ok) throw Object.assign(new Error(data.error || ('HTTP ' + r.status)), { status: r.status, data });
    return data;
  }

  return {
    token, setToken,
    get: p => req('GET', p),
    post: (p, b) => req('POST', p, b),
  };
})();
