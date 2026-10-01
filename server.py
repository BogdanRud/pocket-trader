#!/usr/bin/env python3
"""Pocket Trader backend: static files + JSON API + SQLite + real-price poller.
Run:  py server.py   (serves the whole site on http://localhost:8123)
Only Python standard library is used — no pip installs required.
"""
import http.server, json, sqlite3, hashlib, secrets, os, threading, time, socket
import urllib.request, urllib.parse

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT, 'pt.db')
PORT = int(os.environ.get('PORT', '8123'))

# ---------------------------------------------------------------- database
def db():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c

def init_db():
    c = db()
    c.executescript('''
      CREATE TABLE IF NOT EXISTS users(
        email TEXT PRIMARY KEY, name TEXT, pass TEXT, salt TEXT,
        created INTEGER, guest INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS states(
        email TEXT PRIMARY KEY, json TEXT, updated INTEGER);
      CREATE TABLE IF NOT EXISTS sessions(
        token TEXT PRIMARY KEY, email TEXT, created INTEGER);
    ''')
    c.commit(); c.close()

def hash_pw(pw, salt):
    return hashlib.pbkdf2_hmac('sha256', pw.encode(), salt.encode(), 100_000).hex()

def fresh_state():
    return {
        "account": "demo", "balances": {"demo": 10000, "real": 0},
        "history": [], "trades": [], "pending": [],
        "favorites": ["EURUSD", "BTCUSD"],
        "wins": 0, "losses": 0, "ties": 0, "bestStreak": 0,
        "settings": {"sound": True, "liveQuotes": True},
    }

# ---------------------------------------------------------------- price poller
# assetId -> (source, symbol)
ASSET_SRC = {
    'EURUSD': ('yahoo', 'EURUSD=X'), 'GBPUSD': ('yahoo', 'GBPUSD=X'),
    'USDJPY': ('yahoo', 'USDJPY=X'), 'AUDCAD': ('yahoo', 'AUDCAD=X'),
    'BTCUSD': ('binance', 'BTCUSDT'), 'ETHUSD': ('binance', 'ETHUSDT'),
    'SOLUSD': ('binance', 'SOLUSDT'),
    'XAUUSD': ('yahoo', 'GC=F'), 'XAGUSD': ('yahoo', 'SI=F'),
    'AAPL': ('yahoo', 'AAPL'), 'TSLA': ('yahoo', 'TSLA'), 'SP500': ('yahoo', '^GSPC'),
}
PRICES = {}                 # assetId -> {"price": float, "real": bool, "ts": float}
PRICES_LOCK = threading.Lock()

def fetch_json(url, timeout=8):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())

def poll_binance():
    try:
        syms = [v[1] for v in ASSET_SRC.values() if v[0] == 'binance']
        q = urllib.parse.quote(json.dumps(syms))
        data = fetch_json('https://api.binance.com/api/v3/ticker/price?symbols=' + q)
        m = {d['symbol']: float(d['price']) for d in data}
        with PRICES_LOCK:
            for k, (src, sym) in ASSET_SRC.items():
                if src == 'binance' and sym in m:
                    PRICES[k] = {"price": m[sym], "real": True, "ts": time.time()}
    except Exception as e:
        print('[binance] poll failed:', e)

def poll_yahoo():
    for k, (src, sym) in ASSET_SRC.items():
        if src != 'yahoo':
            continue
        try:
            url = ('https://query1.finance.yahoo.com/v8/finance/chart/'
                   + urllib.parse.quote(sym) + '?range=1d&interval=1m')
            data = fetch_json(url)
            meta = data['chart']['result'][0]['meta']
            p = meta.get('regularMarketPrice')
            if p:
                with PRICES_LOCK:
                    PRICES[k] = {"price": float(p), "real": True, "ts": time.time()}
        except Exception as e:
            pass  # keep whatever we had; frontend falls back to simulation

def poller():
    i = 0
    while True:
        poll_binance()                 # crypto: every 5s
        if i % 4 == 0:                 # forex/stocks/metals/indices: every ~20s
            poll_yahoo()
        i += 1
        time.sleep(5)

# ---------------------------------------------------------------- http handler
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(self, *a):
        pass  # quiet

    # ---- helpers ----
    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        n = int(self.headers.get('Content-Length', 0) or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode())
        except Exception:
            return {}

    def _auth_email(self):
        tok = self.headers.get('Authorization', '').replace('Bearer ', '').strip()
        if not tok:
            return None
        c = db()
        r = c.execute('SELECT email FROM sessions WHERE token=?', (tok,)).fetchone()
        c.close()
        return r['email'] if r else None

    def _user_public(self, email):
        c = db()
        r = c.execute('SELECT email,name,guest,created FROM users WHERE email=?', (email,)).fetchone()
        c.close()
        if not r:
            return None
        return {"email": r['email'], "name": r['name'], "guest": bool(r['guest']), "created": r['created']}

    def _new_session(self, email):
        tok = secrets.token_hex(24)
        c = db()
        c.execute('INSERT INTO sessions(token,email,created) VALUES(?,?,?)', (tok, email, int(time.time())))
        c.commit(); c.close()
        return tok

    # ---- routing ----
    def do_GET(self):
        if self.path.split('?')[0].startswith('/api/'):
            return self.api_get()
        # never serve secrets
        low = self.path.lower()
        if low.endswith('.db') or low.endswith('.py'):
            return self._json(404, {"error": "not found"})
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith('/api/'):
            return self.api_post()
        self._json(404, {"error": "not found"})

    def api_get(self):
        path = self.path.split('?')[0]
        if path == '/api/prices':
            with PRICES_LOCK:
                return self._json(200, PRICES)
        if path == '/api/me':
            email = self._auth_email()
            if not email:
                return self._json(401, {"error": "unauthorized"})
            c = db()
            r = c.execute('SELECT json FROM states WHERE email=?', (email,)).fetchone()
            c.close()
            state = json.loads(r['json']) if r else fresh_state()
            return self._json(200, {"user": self._user_public(email), "state": state})
        if path == '/api/leaderboard':
            return self.leaderboard()
        return self._json(404, {"error": "not found"})

    def api_post(self):
        path = self.path
        body = self._read_body()
        if path == '/api/register':
            return self.register(body)
        if path == '/api/login':
            return self.login(body)
        if path == '/api/guest':
            return self.guest()
        if path == '/api/state':
            return self.save_state(body)
        if path == '/api/profile':
            return self.update_profile(body)
        if path == '/api/logout':
            return self.logout()
        return self._json(404, {"error": "not found"})

    # ---- endpoints ----
    def register(self, body):
        email = (body.get('email') or '').strip().lower()
        pw = body.get('password') or ''
        name = (body.get('name') or '').strip() or (email.split('@')[0] if email else 'trader')
        if '@' not in email or '.' not in email:
            return self._json(400, {"error": "Некорректный email"})
        if len(pw) < 4:
            return self._json(400, {"error": "Пароль минимум 4 символа"})
        c = db()
        if c.execute('SELECT 1 FROM users WHERE email=?', (email,)).fetchone():
            c.close()
            return self._json(409, {"error": "Такой пользователь уже существует"})
        salt = secrets.token_hex(8)
        c.execute('INSERT INTO users(email,name,pass,salt,created,guest) VALUES(?,?,?,?,?,0)',
                  (email, name, hash_pw(pw, salt), salt, int(time.time())))
        c.execute('INSERT INTO states(email,json,updated) VALUES(?,?,?)',
                  (email, json.dumps(fresh_state()), int(time.time())))
        c.commit(); c.close()
        tok = self._new_session(email)
        return self._json(200, {"token": tok, "user": self._user_public(email)})

    def login(self, body):
        email = (body.get('email') or '').strip().lower()
        pw = body.get('password') or ''
        c = db()
        r = c.execute('SELECT pass,salt FROM users WHERE email=?', (email,)).fetchone()
        c.close()
        if not r or r['pass'] != hash_pw(pw, r['salt']):
            return self._json(401, {"error": "Неверный email или пароль"})
        tok = self._new_session(email)
        return self._json(200, {"token": tok, "user": self._user_public(email)})

    def guest(self):
        email = 'guest_' + secrets.token_hex(4)
        c = db()
        c.execute('INSERT INTO users(email,name,pass,salt,created,guest) VALUES(?,?,?,?,?,1)',
                  (email, 'Гость', '', '', int(time.time())))
        c.execute('INSERT INTO states(email,json,updated) VALUES(?,?,?)',
                  (email, json.dumps(fresh_state()), int(time.time())))
        c.commit(); c.close()
        tok = self._new_session(email)
        return self._json(200, {"token": tok, "user": self._user_public(email)})

    def save_state(self, body):
        email = self._auth_email()
        if not email:
            return self._json(401, {"error": "unauthorized"})
        state = body.get('state')
        if not isinstance(state, dict):
            return self._json(400, {"error": "bad state"})
        c = db()
        c.execute('INSERT INTO states(email,json,updated) VALUES(?,?,?) '
                  'ON CONFLICT(email) DO UPDATE SET json=excluded.json, updated=excluded.updated',
                  (email, json.dumps(state), int(time.time())))
        c.commit(); c.close()
        return self._json(200, {"ok": True})

    def update_profile(self, body):
        email = self._auth_email()
        if not email:
            return self._json(401, {"error": "unauthorized"})
        name = (body.get('name') or '').strip()
        if name:
            c = db(); c.execute('UPDATE users SET name=? WHERE email=?', (name, email)); c.commit(); c.close()
        return self._json(200, {"user": self._user_public(email)})

    def logout(self):
        tok = self.headers.get('Authorization', '').replace('Bearer ', '').strip()
        if tok:
            c = db(); c.execute('DELETE FROM sessions WHERE token=?', (tok,)); c.commit(); c.close()
        return self._json(200, {"ok": True})

    def leaderboard(self):
        c = db()
        rows = c.execute('SELECT s.email, u.name, u.guest, s.json FROM states s JOIN users u ON u.email=s.email').fetchall()
        c.close()
        board = []
        for r in rows:
            try:
                st = json.loads(r['json'])
                demo = float(st.get('balances', {}).get('demo', 0))
                wins = int(st.get('wins', 0)); losses = int(st.get('losses', 0))
                total = wins + losses
                board.append({
                    "name": r['name'] or 'trader',
                    "guest": bool(r['guest']),
                    "balance": round(demo, 2),
                    "wins": wins, "losses": losses,
                    "winrate": round(wins / total * 100) if total else 0,
                    "trades": total,
                })
            except Exception:
                pass
        board.sort(key=lambda x: x['balance'], reverse=True)
        return self._json(200, board[:20])


class ThreadingServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    address_family = socket.AF_INET6      # dual-stack: serve IPv6 (::1) AND IPv4 (127.0.0.1)

    def server_bind(self):
        try:
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        except Exception:
            pass
        super().server_bind()


def main():
    init_db()
    threading.Thread(target=poller, daemon=True).start()
    try:
        srv = ThreadingServer(('::', PORT), Handler)
    except OSError:
        # some hosts lack IPv6 — fall back to IPv4 only
        ThreadingServer.address_family = socket.AF_INET
        srv = ThreadingServer(('0.0.0.0', PORT), Handler)
    print(f'Pocket Trader server running:  http://localhost:{PORT}')
    print('  API: /api/prices  /api/register  /api/login  /api/me  /api/state  /api/leaderboard')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\nstopped')


if __name__ == '__main__':
    main()
