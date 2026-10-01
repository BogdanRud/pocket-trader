/* ===== Personal cabinet logic ===== */
(function () {
  const $ = s => document.querySelector(s);
  const fmt = v => '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const user = Store.currentUser();
  if (!user) { location.href = 'index.html'; return; }
  let state = null;

  // set an avatar element to a photo (data URL), emoji, or initial
  function setAvatar(el, avatar, fallback) {
    if (avatar && avatar.slice(0, 5) === 'data:') { el.style.backgroundImage = `url(${avatar})`; el.textContent = ''; el.classList.add('has-img'); }
    else { el.style.backgroundImage = ''; el.classList.remove('has-img'); el.textContent = avatar || fallback; }
  }

  async function load() {
    state = await Store.loadState();
    if (!state) { location.href = 'index.html'; return; }
    renderProfile(); renderStats(); renderTransactions(); renderHistory(); renderReferrals();
  }

  function renderProfile() {
    const name = user.name || 'Трейдер';
    const initial = name[0].toUpperCase();
    setAvatar($('#avatar'), user.avatar, initial);
    setAvatar($('#avPreview'), user.avatar, initial);
    $('#uName').textContent = name;
    $('#uEmail').textContent = user.guest ? 'Гостевой аккаунт' : user.email;
    const badge = $('#uBadge');
    if (user.guest) { badge.textContent = 'Гость'; badge.classList.add('guest'); } else badge.textContent = 'Зарегистрирован';
    if (user.created) $('#uSince').textContent = 'С нами с ' + new Date((user.created > 1e12 ? user.created : user.created * 1000)).toLocaleDateString('ru-RU');
  }

  function renderStats() {
    const wins = state.wins || 0, losses = state.losses || 0, total = wins + losses;
    $('#stWins').textContent = wins;
    $('#stLosses').textContent = losses;
    $('#stWr').textContent = total ? Math.round(wins / total * 100) + '%' : '—';
    $('#stTrades').textContent = total;
    $('#stStreak').textContent = state.bestStreak || 0;
    const pnl = (state.history || []).reduce((s, t) => s + (t.profit || 0), 0);
    const el = $('#stPnl');
    el.textContent = (pnl >= 0 ? '+' : '−') + fmt(Math.abs(pnl));
    el.className = 'v ' + (pnl >= 0 ? 'up' : 'down');
  }

  function renderTransactions() {
    const body = $('#txBody');
    const h = state.history || [];
    if (!h.length) { body.innerHTML = `<tr><td colspan="5" class="empty">Пока нет транзакций</td></tr>`; return; }
    let running = state.balances.demo || 0;
    const rows = h.slice(0, 100).map(t => {
      const net = t.status === 'win' ? (t.profit || 0) : (t.status === 'tie' ? 0 : -(t.amount || 0));
      const after = running; running -= net;
      const cls = net > 0 ? 'win' : (net < 0 ? 'loss' : '');
      const type = t.status === 'win' ? '▲ Выигрыш' : (t.status === 'tie' ? 'Возврат' : '▼ Проигрыш');
      return `<tr><td class="res ${cls}">${type}</td><td>${t.assetName || t.asset}</td>
        <td class="res ${cls} mono">${net > 0 ? '+' : (net < 0 ? '−' : '')}${fmt(Math.abs(net))}</td>
        <td class="mono">${fmt(after)}</td>
        <td class="mono" style="color:var(--text-mute)">${t.closeT ? new Date(t.closeT).toLocaleString('ru-RU') : '—'}</td></tr>`;
    });
    body.innerHTML = rows.join('');
  }

  function renderHistory() {
    const body = $('#histBody');
    const h = state.history || [];
    if (!h.length) { body.innerHTML = `<tr><td colspan="6" class="empty">История пуста — сделайте первую сделку</td></tr>`; return; }
    body.innerHTML = h.slice(0, 100).map(t => {
      const res = t.status === 'win' ? 'win' : (t.status === 'tie' ? '' : 'loss');
      const resText = t.status === 'win' ? '+' + fmt(t.profit) : (t.status === 'tie' ? 'Возврат' : '−' + fmt(t.amount));
      const d = t.digits != null ? t.digits : 4;
      return `<tr>
        <td><span class="dir ${t.dir}">${t.dir === 'higher' ? '▲' : '▼'}</span></td>
        <td><b>${t.assetName || t.asset}</b></td>
        <td class="mono">${fmt(t.amount)}</td>
        <td class="mono">${Number(t.entry).toFixed(d)} → ${Number(t.close).toFixed(d)}</td>
        <td class="res ${res}">${resText}</td>
        <td class="mono" style="color:var(--text-mute)">${t.closeT ? new Date(t.closeT).toLocaleString('ru-RU') : '—'}</td>
      </tr>`;
    }).join('');
  }

  async function renderReferrals() {
    const r = await Store.referrals();
    if (!r || !r.code) { $('#refLink').value = 'Недоступно (нужен сервер)'; return; }
    const link = location.origin + '/index.html?ref=' + r.code;
    $('#refLink').value = link;
    $('#refCount').textContent = r.count;
    if (r.rate != null && $('#refRate')) $('#refRate').textContent = r.rate + '%';
    if ($('#refTurnover')) $('#refTurnover').textContent = '$' + Number(r.turnover || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
    $('#refEarned').textContent = '$' + Number(r.earned).toLocaleString('en-US', { maximumFractionDigits: 2 });
    $('#refCopy').onclick = () => {
      const done = () => { $('#refCopy').textContent = 'Скопировано ✓'; setTimeout(() => $('#refCopy').textContent = 'Копировать', 1500); };
      if (navigator.clipboard) navigator.clipboard.writeText(link).then(done, () => { $('#refLink').select(); document.execCommand('copy'); done(); });
      else { $('#refLink').select(); document.execCommand('copy'); done(); }
    };
  }

  // ---- avatar photo upload (resize to a small square JPEG data URL) ----
  function resizeImage(file, size) {
    return new Promise((resolve, reject) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = size; c.height = size;
        const ctx = c.getContext('2d');
        const s = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = reject; img.src = url;
    });
  }
  $('#avUploadBtn').onclick = () => $('#avFile').click();
  $('#avFile').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const dataUrl = await resizeImage(file, 160);
      const u = await Store.updateProfile({ avatar: dataUrl });
      if (u) { user.avatar = u.avatar; renderProfile(); }
    } catch (err) {}
    e.target.value = '';
  };
  $('#avRemoveBtn').onclick = async () => {
    const u = await Store.updateProfile({ avatar: '' });
    if (u) { user.avatar = ''; renderProfile(); }
  };

  // ---- name edit ----
  $('#editName').onclick = () => { $('#nameEdit').classList.toggle('open'); $('#nameInput').value = user.name || ''; $('#nameInput').focus(); };
  $('#saveName').onclick = async () => {
    const v = $('#nameInput').value.trim(); if (!v) return;
    const u = await Store.updateProfile({ name: v });
    if (u) { user.name = u.name; renderProfile(); $('#nameEdit').classList.remove('open'); }
  };
  $('#nameInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#saveName').click(); });

  // ---- password change ----
  $('#savePass').onclick = async () => {
    const oldP = $('#oldPass').value, newP = $('#newPass').value, msg = $('#passMsg');
    if (!oldP || !newP) { msg.textContent = 'Заполните оба поля'; msg.className = 'pass-msg err'; return; }
    const res = await Store.changePassword(oldP, newP);
    if (res.ok) { msg.textContent = 'Пароль изменён ✓'; msg.className = 'pass-msg ok'; $('#oldPass').value = ''; $('#newPass').value = ''; }
    else { msg.textContent = res.error; msg.className = 'pass-msg err'; }
  };

  $('#logoutBtn').onclick = async () => { await Store.logout(); location.href = 'index.html'; };

  load();
})();
