// CTO Review – Pages advanced-mode worker (shared-password login, roles, login stats).
// Secrets (Pages project env, type secret_text): SHARED_PASSWORD, ADMIN_PASSWORD, SESSION_SECRET.
// Password secrets may be plain text or "sha256$<salt>$<hex>" where hex = SHA-256(salt + ":" + password).
// KV binding LOGINS: login events (key "ev:<iso>:<rand>", data in metadata) and rate-limit counters ("rl:").
// Fails closed (503) when a secret or the KV binding is missing.

const COOKIE = "ctor_s";
const SESSION_TTL = 7 * 24 * 3600;           // 7 days
const EVENT_TTL = 400 * 24 * 3600;           // 400 days
const RL_WINDOW = 15 * 60, RL_MAX = 10;      // 10 failed attempts per IP per 15 minutes
const MEM_FAILS = new Map();                 // per-isolate burst counter (see handleLogin)
function pruneMem() {
  const cur = Math.floor(Date.now() / 1000 / RL_WINDOW);
  for (const k of MEM_FAILS.keys()) if (+k.split(":").pop() < cur - 1 || MEM_FAILS.size > 5000) MEM_FAILS.delete(k);
}
const USERS = { cto: "reader", admin: "admin" };
const PUBLIC = new Set(["/login", "/login/", "/logout", "/logout/", "/assets/style.css",
  "/assets/theme.js", "/assets/login.js", "/assets/favicon.svg", "/assets/fonts/heebo-var.woff2", "/robots.txt"]);
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; " +
  "connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";
const SEC_HEADERS = {
  "X-Robots-Tag": "noindex, nofollow", "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer", "Cache-Control": "no-store", "Content-Security-Policy": CSP,
};

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uDecode = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

function ctEqual(a, b) {               // constant-time over equal-length strings (inputs are fixed-length digests)
  const x = enc.encode(a), y = enc.encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}

async function checkPassword(secret, given) {
  if (!secret || typeof given !== "string" || !given) return false;
  if (secret.startsWith("sha256$")) {
    const [, salt, want] = secret.split("$");
    return ctEqual(await sha256(salt + ":" + given), want);
  }
  // plain-text secret: compare digests so timing does not depend on content or length
  return ctEqual(await sha256("p:" + given), await sha256("p:" + secret));
}

async function hmacKey(env, role) {
  const pw = role === "admin" ? env.ADMIN_PASSWORD : env.SHARED_PASSWORD;
  // Binding the key to the role's password secret: rotating a password ends that role's sessions.
  return crypto.subtle.importKey("raw", enc.encode(env.SESSION_SECRET + "|" + role + "|" + pw),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function makeSession(env, role) {
  const payload = b64u(enc.encode(JSON.stringify({ r: role, e: Math.floor(Date.now() / 1000) + SESSION_TTL })));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env, role), enc.encode(payload));
  return payload + "." + b64u(sig);
}

async function readSession(env, request) {
  const m = (request.headers.get("Cookie") || "").match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([A-Za-z0-9_\\-]+)\\.([A-Za-z0-9_\\-]+)"));
  if (!m) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(b64uDecode(m[1])));
    if (!data || !["reader", "admin"].includes(data.r) || !(data.e > Date.now() / 1000)) return null;
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(env, data.r), b64uDecode(m[2]), enc.encode(m[1]));
    return ok ? data.r : null;
  } catch (e) { return null; }
}

function withHeaders(resp, extra = {}) {
  const r = new Response(resp.body, resp);
  for (const [k, v] of Object.entries({ ...SEC_HEADERS, ...extra })) r.headers.set(k, v);
  return r;
}

function safeNext(n) {
  if (typeof n !== "string" || !n.startsWith("/") || n.startsWith("//") || /[\\\r\n]/.test(n) || n.length > 300) return "/";
  if (n.startsWith("/login") || n.startsWith("/logout")) return "/";
  return n;
}

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function loginPage({ next = "/", error = "", notice = "", user = "", status = 200 }) {
  const msg = error ? `<p class="login-msg err" role="alert">${escHtml(error)}</p>`
    : notice ? `<p class="login-msg" role="status">${escHtml(notice)}</p>` : "";
  const html = `<!doctype html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="robots" content="noindex,nofollow">
<title>כניסה | CTO Review</title>
<script src="/assets/theme.js"></script>
<link rel="preload" href="/assets/fonts/heebo-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/style.css">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
</head>
<body class="login-body">
<header class="masthead"><div class="wrap">
<span class="brand"><span class="mark" dir="ltr">CTO<b>Review</b></span><span class="tag">סקירת טכנולוגיה יומית</span></span>
</div></header>
<div class="wrap login-wrap">
<main id="main" class="login-card">
<h1>כניסה לאתר</h1>
<p class="kicker">האתר פנימי. יש להזין את שם המשתמש והסיסמה שקיבלתם.</p>
${msg}
<form method="post" action="/login" class="login-form">
<input type="hidden" name="next" value="${escHtml(next)}">
<label class="fl"><span>שם משתמש</span><input name="username" type="text" dir="ltr" autocomplete="username" autocapitalize="none" spellcheck="false" required value="${escHtml(user)}"></label>
<label class="fl"><span>סיסמה</span><input name="password" type="password" dir="ltr" autocomplete="current-password" required></label>
<button type="submit" class="login-btn">כניסה</button>
</form>
</main>
</div>
<footer class="foot"><div class="wrap"><bdi>CTO Review</bdi> · סקירת טכנולוגיה יומית · 2026</div></footer>
<script src="/assets/login.js" defer></script>
</body>
</html>`;
  return withHeaders(new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } }));
}

function parseUA(ua) {
  ua = ua || "";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /Firefox\/|FxiOS/.test(ua) ? "Firefox" : /Chrome\/|CriOS/.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari"
    : /curl|wget|python|bot|spider|crawl/i.test(ua) ? "Bot / script" : "Other";
  const os = /Windows/.test(ua) ? "Windows" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "Other";
  const device = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua)) ? "tablet"
    : /Mobi|iPhone|Android/.test(ua) ? "mobile" : browser === "Bot / script" ? "other" : "desktop";
  return { browser, os, device };
}

const ipHash = async (env, ip) => (await sha256("ip|" + env.SESSION_SECRET + "|" + (ip || "?"))).slice(0, 16);

async function logEvent(env, request, outcome, role, vh) {
  const cf = request.cf || {};
  const now = new Date().toISOString();
  const meta = { t: now, o: outcome, r: role || "", c: cf.country || "", ci: (cf.city || "").slice(0, 60),
    ...parseUA(request.headers.get("User-Agent")), v: vh };
  const key = "ev:" + now + ":" + crypto.randomUUID().slice(0, 8);
  try { await env.LOGINS.put(key, "", { metadata: meta, expirationTtl: EVENT_TTL }); } catch (e) { /* stay up if the KV write quota is exhausted */ }
}

async function handleLogin(request, env, url) {
  if (request.method === "GET" || request.method === "HEAD") {
    const role = await readSession(env, request);
    const next = safeNext(url.searchParams.get("next") || "/");
    if (url.searchParams.get("need") === "admin")
      return loginPage({ next, notice: "האזור הזה מיועד למנהלים בלבד. כדי להמשיך, היכנסו עם שם המשתמש admin.", user: "admin", status: role ? 403 : 200 });
    if (role) return Response.redirect(url.origin + next, 303);
    return loginPage({ next, notice: url.searchParams.get("out") ? "יצאתם מהאתר." : "" });
  }
  if (request.method !== "POST") return withHeaders(new Response("Method not allowed", { status: 405 }));
  // Referrer-Policy: no-referrer makes browsers send "Origin: null" on same-site form posts,
  // so treat "null" as unknown and fall back to Sec-Fetch-Site for CSRF protection.
  const origin = request.headers.get("Origin");
  const sfs = request.headers.get("Sec-Fetch-Site");
  if (origin && origin !== "null" && origin !== url.origin) return withHeaders(new Response("Forbidden", { status: 403 }));
  if (sfs && sfs !== "same-origin" && sfs !== "none") return withHeaders(new Response("Forbidden", { status: 403 }));
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const vh = await ipHash(env, ip);
  const rlKey = "rl:" + vh + ":" + Math.floor(Date.now() / 1000 / RL_WINDOW);
  // KV reads are eventually consistent (edge-cached ~60 s), so a fast burst would not see its own writes.
  // An in-memory per-isolate counter catches bursts at once; KV carries the count across isolates/colos.
  pruneMem();
  const fails = Math.max(parseInt((await env.LOGINS.get(rlKey)) || "0", 10) || 0, MEM_FAILS.get(rlKey) || 0);
  if (fails >= RL_MAX) {
    const r = loginPage({ error: "יותר מדי ניסיונות כניסה כושלים. נסו שוב בעוד כרבע שעה.", status: 429 });
    r.headers.set("Retry-After", String(RL_WINDOW));
    return r;
  }
  let form;
  try { form = await request.formData(); } catch (e) { return loginPage({ error: "הבקשה לא תקינה.", status: 400 }); }
  const user = String(form.get("username") || "").trim().toLowerCase().slice(0, 40);
  const pass = String(form.get("password") || "");
  const next = safeNext(String(form.get("next") || "/"));
  const role = USERS[user];
  // Always run the comparison so response time does not reveal valid usernames.
  const ok = await checkPassword(role === "admin" ? env.ADMIN_PASSWORD : env.SHARED_PASSWORD, pass) && !!role;
  if (!ok) {
    MEM_FAILS.set(rlKey, fails + 1);
    try { await env.LOGINS.put(rlKey, String(fails + 1), { expirationTtl: RL_WINDOW * 2 }); } catch (e) {}
    await new Promise((r) => setTimeout(r, 800));   // slow down guessing (wall time, not CPU time)
    await logEvent(env, request, "fail", role || "", vh);
    return loginPage({ next, user: role ? user : "", error: "שם המשתמש או הסיסמה שגויים.", status: 401 });
  }
  await logEvent(env, request, "success", role, vh);
  const dest = next.startsWith("/admin") && role !== "admin" ? "/" : next;
  return withHeaders(new Response(null, { status: 303, headers: {
    Location: dest,
    "Set-Cookie": `${COOKIE}=${await makeSession(env, role)}; Path=/; Max-Age=${SESSION_TTL}; HttpOnly; Secure; SameSite=Lax`,
  } }));
}

async function statsData(env) {
  const events = [];
  let cursor;
  for (let i = 0; i < 20; i++) {               // up to 20k events per request
    const page = await env.LOGINS.list({ prefix: "ev:", cursor, limit: 1000 });
    for (const k of page.keys) if (k.metadata) events.push(k.metadata);
    if (page.list_complete) break;
    cursor = page.cursor;
  }
  events.sort((a, b) => (a.t < b.t ? 1 : -1));
  return withHeaders(new Response(JSON.stringify({ generated: new Date().toISOString(), events }),
    { headers: { "Content-Type": "application/json; charset=utf-8" } }));
}

// Canonical form of a path for access decisions: percent-decoded (repeatedly), backslashes and
// repeated slashes collapsed, lower-cased. Pages' asset server decodes and collapses paths, so
// "//admin/", "/%61dmin/" or "/admin%2Fsources.json" must count as the admin area too.
function canonPath(p) {
  let c = p;
  for (let i = 0; i < 4; i++) {
    let d;
    try { d = decodeURIComponent(c); } catch { return null; }
    if (d === c) break;
    c = d;
  }
  return c.replace(/\\/g, "/").replace(/\/{2,}/g, "/").toLowerCase();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const canon = canonPath(path);
    if (canon === null) return withHeaders(new Response("Bad request", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } }));
    if (!env.SESSION_SECRET || !env.SHARED_PASSWORD || !env.ADMIN_PASSWORD || !env.LOGINS)
      return withHeaders(new Response("Service not configured", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }));

    if (path === "/login" || path === "/login/") return handleLogin(request, env, url);
    if (path === "/logout" || path === "/logout/")
      return withHeaders(new Response(null, { status: 303, headers: {
        Location: "/login?out=1",
        "Set-Cookie": `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
      } }));
    if (PUBLIC.has(path)) return withHeaders(await env.ASSETS.fetch(request));

    const role = await readSession(env, request);
    const next = encodeURIComponent(path + url.search);
    const isAdminPath = /^\/admin(?:[\/;.]|$)/.test(canon);
    if (!role) {
      if (path.endsWith(".json") || request.headers.get("Accept")?.includes("application/json") && !request.headers.get("Accept")?.includes("text/html"))
        return withHeaders(new Response(JSON.stringify({ error: "login required" }), { status: 401, headers: { "Content-Type": "application/json" } }));
      return withHeaders(new Response(null, { status: 303, headers: { Location: "/login?next=" + next + (isAdminPath ? "&need=admin" : "") } }));
    }
    if (isAdminPath && role !== "admin") {
      if (canon.endsWith(".json")) return withHeaders(new Response(JSON.stringify({ error: "admin only" }), { status: 403, headers: { "Content-Type": "application/json" } }));
      return loginPage({ next: path + url.search, notice: "האזור הזה מיועד למנהלים בלבד. כדי להמשיך, היכנסו עם שם המשתמש admin.", user: "admin", status: 403 });
    }
    if (canon === "/admin/stats/data.json") return statsData(env);

    let resp = withHeaders(await env.ASSETS.fetch(request));
    if (role !== "admin" && (resp.headers.get("Content-Type") || "").includes("text/html")) {
      // Readers never see links into the admin area.
      resp = new HTMLRewriter().on("[data-admin]", { element(el) { el.remove(); } }).transform(resp);
    }
    return resp;
  },
};
