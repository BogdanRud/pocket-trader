/* ===== Landing page logic ===== */
(function () {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  // already logged in → go straight to the terminal (no need to sign in each visit).
  // a dead token is handled by the terminal: it clears the session and bounces back here.
  const cur = Store.currentUser();
  if (cur) { location.href = 'terminal.html'; return; }

  /* ---- real prices from backend ---- */
  let REAL = {};
  const fmt = (v, dec) => Number(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  async function pullPrices() { try { REAL = await (await fetch('/api/prices', { cache: 'no-store' })).json(); } catch (e) {} }

  /* ---- market grid (real prices) ---- */
  const MK = [
    { n:'EUR/USD', id:'EURUSD', pay:92, c:'#3b8cf5', a:'€$', dec:5 },
    { n:'BTC/USD', id:'BTCUSD', pay:88, c:'#f7931a', a:'₿', dec:1 },
    { n:'Gold',    id:'XAUUSD', pay:83, c:'#ffd54f', a:'Au', dec:2 },
    { n:'ETH/USD', id:'ETHUSD', pay:86, c:'#627eea', a:'Ξ', dec:2 },
    { n:'GBP/USD', id:'GBPUSD', pay:90, c:'#5c6bc0', a:'£$', dec:5 },
    { n:'Tesla',   id:'TSLA',   pay:82, c:'#e82127', a:'T', dec:2 },
    { n:'S&P 500', id:'SP500',  pay:79, c:'#66bb6a', a:'S&', dec:1 },
    { n:'SOL/USD', id:'SOLUSD', pay:84, c:'#14f195', a:'◎', dec:2 },
  ];
  const grid = $('#marketGrid');
  if (grid) grid.innerHTML = MK.map(m => `
    <div class="mkt">
      <div class="ic" style="background:${m.c}">${m.a}</div>
      <div><div class="nm">${m.n}</div><div class="pr" data-id="${m.id}" data-dec="${m.dec}">—</div></div>
      <div class="pay">${m.pay}%</div>
    </div>`).join('');
  function renderGrid() {
    $$('#marketGrid .pr').forEach(el => {
      const d = REAL[el.dataset.id]; if (!d) return;
      const prev = parseFloat((el.textContent || '').replace(/,/g, '')) || d.price;
      el.textContent = fmt(d.price, +el.dataset.dec);
      el.style.color = d.price >= prev ? 'var(--green)' : 'var(--red)';
    });
  }

  /* ---- hero mini chart (anchored to the real BTC price) ---- */
  const canvas = $('#heroChart');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    let data = [], price = 0, base0 = 0, W, H, seeded = false;
    function resize() { const r = canvas.getBoundingClientRect(); W = r.width; H = r.height; canvas.width = W*dpr; canvas.height = H*dpr; ctx.setTransform(dpr,0,0,dpr,0,0); }
    new ResizeObserver(resize).observe(canvas); resize();
    function draw() {
      const anchor = REAL.BTCUSD && REAL.BTCUSD.price;
      if (!seeded) { if (!anchor) return; price = base0 = anchor; for (let i=0;i<60;i++){ price += (Math.random()-0.5)*anchor*0.0012; data.push(price); } base0 = data[0]; seeded = true; }
      price += (anchor - price) * 0.1 + (Math.random() - 0.5) * anchor * 0.0009;   // walk toward real
      data.push(price); if (data.length > 60) data.shift();
      let hi=Math.max(...data), lo=Math.min(...data); const rng=(hi-lo)||1, pad=rng*0.15; hi+=pad; lo-=pad; const range=hi-lo;
      const x=i=>(i/(data.length-1))*W, y=v=>H-((v-lo)/range)*H;
      ctx.clearRect(0,0,W,H);
      ctx.beginPath(); data.forEach((v,i)=>i?ctx.lineTo(x(i),y(v)):ctx.moveTo(x(i),y(v)));
      ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.closePath();
      const g=ctx.createLinearGradient(0,0,0,H); g.addColorStop(0,'rgba(33,193,122,.35)'); g.addColorStop(1,'rgba(33,193,122,0)'); ctx.fillStyle=g; ctx.fill();
      ctx.beginPath(); data.forEach((v,i)=>i?ctx.lineTo(x(i),y(v)):ctx.moveTo(x(i),y(v))); ctx.strokeStyle='#21c17a'; ctx.lineWidth=2; ctx.stroke();
      ctx.fillStyle='#21c17a'; ctx.beginPath(); ctx.arc(x(data.length-1),y(price),3.5,0,7); ctx.fill();
      const chg=(price-base0)/base0*100, up=chg>=0;
      $('#heroPrice').textContent = fmt(price, 1);
      $('#heroChg').textContent = (up?'▲ +':'▼ ')+chg.toFixed(2)+'%';
      $('#heroChg').style.color = up?'var(--green)':'var(--red)';
    }
    setInterval(draw, 700);
  }

  // prime real prices, then keep grid + hero updating
  (async () => { await pullPrices(); renderGrid(); setInterval(async () => { await pullPrices(); renderGrid(); }, 4000); })();

  /* ---- auth modal ---- */
  const overlay = $('#authOverlay');
  let mode = 'login';
  function openAuth(m) { mode = m; syncMode(); overlay.classList.add('open'); $('#authErr').classList.remove('show'); }
  function closeAuth() { overlay.classList.remove('open'); }
  function syncMode() {
    $$('.auth-head button').forEach(b => b.classList.toggle('active', b.dataset.tab === mode));
    $('#nameGroup').style.display = mode === 'register' ? 'block' : 'none';
    $('#authSubmit').textContent = mode === 'register' ? 'Создать аккаунт' : 'Войти';
    $('#authPass').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    $('#authAlt').innerHTML = mode === 'register'
      ? 'Уже есть аккаунт? <a id="authSwitch">Войти</a>'
      : 'Нет аккаунта? <a id="authSwitch">Зарегистрироваться</a>';
    $('#authSwitch').onclick = () => { mode = mode === 'register' ? 'login' : 'register'; syncMode(); $('#authErr').classList.remove('show'); };
  }
  function showErr(msg) { const e = $('#authErr'); e.textContent = msg; e.classList.add('show'); }

  $('#navLogin') && !cur && ($('#navLogin').onclick = () => openAuth('login'));
  $('#navRegister').onclick = () => openAuth('register');
  $('#heroStart').onclick = () => cur ? location.href = 'terminal.html' : openAuth('register');
  $('#ctaStart').onclick = () => cur ? location.href = 'terminal.html' : openAuth('register');
  $$('.auth-head button').forEach(b => b.onclick = () => { mode = b.dataset.tab; syncMode(); $('#authErr').classList.remove('show'); });
  overlay.onclick = e => { if (e.target === overlay) closeAuth(); };

  async function submit() {
    const email = $('#authEmail').value, pass = $('#authPass').value, name = $('#authName').value;
    const btn = $('#authSubmit'); const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Подождите…';
    try {
      const ref = (new URLSearchParams(location.search).get('ref') || '').trim();
      const res = mode === 'register' ? await Store.register(email, pass, name, ref) : await Store.login(email, pass);
      if (!res.ok) { btn.disabled = false; btn.textContent = label; return showErr(res.error); }
      location.href = 'terminal.html';
    } catch (e) { btn.disabled = false; btn.textContent = label; showErr('Ошибка соединения'); }
  }
  const EYE = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.9 17.9A10.1 10.1 0 0 1 12 20C5 20 1 12 1 12a18.5 18.5 0 0 1 5.1-6M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2m-6.7-1.1a3 3 0 1 1-4.2-4.2"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  $('#authPassEye').onclick = () => {
    const i = $('#authPass'), show = i.type === 'password';
    i.type = show ? 'text' : 'password';
    $('#authPassEye').innerHTML = show ? EYE_OFF : EYE;
  };
  $('#authSubmit').onclick = submit;
  $('#authPass').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
})();
