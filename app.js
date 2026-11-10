/* Grok Bot desk app. Plain JS. Every FOMO URL shown here comes from the server (links.py). */
(function () {
  'use strict';
  const BUILD = '202611091957';
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- token / data path from the URL fragment, then localStorage ----
  // Parse #t= / #d= even when mixed with #/routes. Persist so the home-screen icon works without the fragment.
  (function ingestAuth() {
    const h = location.hash || '';
    const qs = new URLSearchParams(location.search || '');
    let changed = false;
    let route = '#/home';
    if (h.startsWith('#/')) route = h;
    // Query params survive Telegram → Safari handoff better than fragments alone.
    if (qs.get('t')) { localStorage.setItem('desk_token', qs.get('t')); localStorage.removeItem('desk_data'); changed = true; }
    if (qs.get('d')) { localStorage.setItem('desk_data', qs.get('d')); localStorage.removeItem('desk_token'); changed = true; }
    let m = h.match(/(?:^#|[?&])t=([^&\/]+)/);
    if (m) { localStorage.setItem('desk_token', decodeURIComponent(m[1])); localStorage.removeItem('desk_data'); changed = true; }
    m = h.match(/(?:^#|[?&])d=([^&\/]+)/);
    if (m) { localStorage.setItem('desk_data', decodeURIComponent(m[1])); localStorage.removeItem('desk_token'); changed = true; }
    // Pure auth hashes (#d=… / #t=…) become #/home; keep real routes like #/account.
    if (/^#[dt]=/.test(h)) { changed = true; route = '#/home'; }
    if (changed || qs.has('v') || true) {
      const path = location.pathname.endsWith('/') || location.pathname.endsWith('.html')
        ? location.pathname : (location.pathname + '/');
      const keep = new URLSearchParams();
      keep.set('v', qs.get('v') || BUILD);
      history.replaceState(null, '', path + '?' + keep.toString() + (route.startsWith('#') ? route : '#/home'));
    }
  })();
  const TOKEN = () => localStorage.getItem('desk_token');
  const DATA = () => localStorage.getItem('desk_data');
  const PLAN_B = () => !TOKEN() && !!DATA();
  // Directory of this app on GitHub Pages project sites (…/tf-desk/…), never the host root.
  function appDir() {
    let p = location.pathname || '/';
    if (!p.endsWith('/')) p = p.replace(/\/[^/]*$/, '/');
    if (!p.endsWith('/')) p += '/';
    return p;
  }
  function dataBase() {
    const d = DATA();
    if (!d) throw new Error('missing data path · reopen the app link from Telegram');
    return appDir() + 'd/' + encodeURIComponent(d) + '/';
  }
  // Plan B: unregister any leftover service worker so it cannot serve a stale app.js
  if (PLAN_B() && 'serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
  }

  const S = { state: null, chart: null, activity: null, account: null, range: 'LIVE', lastOk: null, failN: 0, retryAt: 0, audits: {} };

  async function api(path, opt) {
    opt = opt || {};
    let url = path, headers = { 'Content-Type': 'application/json' };
    if (PLAN_B()) {
      const base = dataBase();
      if (opt.method && opt.method !== 'GET') throw new Error('read-only (plan B): use Telegram commands');
      const p = path.replace(/^\/api\//, '');
      if (p.startsWith('state')) url = base + 'state.json';
      else if (p.startsWith('chart')) url = base + 'chart.json';
      else if (p.startsWith('activity')) url = base + 'activity.json';
      else if (p.startsWith('account')) url = base + 'account.json';
      else if (p.startsWith('coin/')) url = base + 'coin/' + p.slice(5).split('?')[0] + '.json';
      else if (p.startsWith('audit/')) url = base + 'coin/' + p.slice(6).split('?')[0] + '.json';
      else if (p.startsWith('search') || p.startsWith('pushes/') || p.startsWith('settings') || p.startsWith('mode') || p.startsWith('testpush') || p.startsWith('push') || p.startsWith('stream') || p.startsWith('agents/'))
        throw new Error('n/a in plan B · use Telegram');
      else throw new Error('n/a in plan B');
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      let j = await r.json();
      if (p.startsWith('chart')) j = j[S.range] || j.LIVE;
      if (p.startsWith('audit/')) j = j.audit;
      return j;
    }
    if (TOKEN()) headers.Authorization = 'Bearer ' + TOKEN();
    const r = await fetch(url, { method: opt.method || 'GET', headers, body: opt.body ? JSON.stringify(opt.body) : undefined, cache: 'no-store' });
    if (r.status === 401) { const e = new Error('401'); e.auth = true; throw e; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || j.detail || ('HTTP ' + r.status)); e.status = r.status; e.body = j; throw e; }
    return j;
  }

  // ---- error row: keep the last good numbers, never blank ----
  function ok() { S.lastOk = new Date(); S.failN = 0; $('#offline').hidden = true; }
  function fail(e) {
    S.failN++;
    const wait = Math.min(30, 3 * S.failN);
    S.retryAt = Date.now() + wait * 1000;
    showOffline(e);
  }
  function showOffline(e) {
    const el = $('#offline');
    const n = Math.max(0, Math.ceil((S.retryAt - Date.now()) / 1000));
    const last = S.lastOk ? S.lastOk.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'never';
    let why = '';
    if (e && e.auth) why = 'not signed in';
    else if (e && e.message) why = String(e.message).slice(0, 80);
    else if (!DATA() && !TOKEN()) why = 'missing data path · reopen the Telegram link';
    const main = (e && e.auth)
      ? 'Not signed in · open the app once from your #t= link'
      : ('Desk offline · retrying in ' + n + 's · last update ' + last);
    el.innerHTML = esc(main) + '<div class="offline-why">' + esc(why ? (why + ' · build ' + BUILD) : ('build ' + BUILD)) + '</div>';
    el.hidden = false;
  }
  setInterval(() => { if (!$('#offline').hidden && S.failN) showOffline(); }, 1000);

  // ---- formatting ----
  const usd = (v, d = 2) => v == null ? 'n/a' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const kusd = v => v == null ? 'n/a' : v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? '$' + (v / 1e3).toFixed(1) + 'K' : '$' + Number(v).toFixed(0);
  const price = v => v == null ? 'n/a' : v >= 1 ? '$' + v.toFixed(4) : '$' + Number(v).toPrecision(4);
  const pct = v => v == null ? '' : (v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%';
  const tm = ts => new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const ago = h => h == null ? '' : h < 1 ? Math.round(h * 60) + 'm old' : Math.round(h) + 'h old';

  // ---- odometer: each changed digit rolls 600ms ease-out, 30ms stagger right to left ----
  function odometer(el, text) {
    const prev = el._text || '';
    if (reduced() || !prev || prev.length !== text.length) {
      el.innerHTML = '';
      el.classList.add('odo');
      [...text].forEach(ch => {
        const d = document.createElement('span');
        if (/\d/.test(ch)) {
          d.className = 'd'; d.innerHTML = '<span class="strip">' + [...'0123456789'].map(x => '<span>' + x + '</span>').join('') + '</span>';
          d.firstChild.style.transition = 'none'; d.firstChild.style.transform = `translateY(-${(+ch) * 1.05}em)`;
        } else { d.textContent = ch; }
        el.appendChild(d);
      });
      el._text = text; return;
    }
    const kids = [...el.children]; let k = 0;
    for (let i = text.length - 1; i >= 0; i--) {
      if (text[i] !== prev[i] && /\d/.test(text[i]) && kids[i].firstChild && kids[i].firstChild.style) {
        const s = kids[i].firstChild; const delay = (k++) * 30;
        s.style.transition = `transform 600ms cubic-bezier(.2,.8,.2,1) ${delay}ms`;
        s.style.transform = `translateY(-${(+text[i]) * 1.05}em)`;
      } else if (text[i] !== prev[i]) { kids[i].textContent = text[i]; }
    }
    el._text = text;
  }

  // ---- router ----
  function route() {
    const h = location.hash || '#/home';
    const [, tab, arg] = h.match(/^#\/(\w+)(?:\/(.+))?/) || [, 'home'];
    document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
    const sheet = $('#sheet');
    if (tab === 'coin' || tab === 'audit') { sheet.hidden = false; (tab === 'coin' ? renderCoin : renderAudit)(decodeURIComponent(arg)); return; }
    sheet.hidden = true; sheet.innerHTML = ''; removeCta();
    ({ home: renderHome, agents: renderAgents, activity: renderActivity, account: renderAccount }[tab] || renderHome)();
  }
  window.addEventListener('hashchange', route);
  function removeCta() { document.querySelectorAll('.cta').forEach(e => e.remove()); }

  // ---- HOME ----
  function skelHome() {
    return `<div class="navbar"><div class="skel" style="width:32px;height:32px;border-radius:16px"></div><div class="title"></div></div>
      <div class="bal-wrap"><div class="skel" style="height:70px;width:70%"></div><div class="skel" style="height:18px;width:40%;margin-top:8px"></div></div>
      <div class="skel" style="height:220px;margin:12px 16px 0"></div>
      <div class="section-h"><h2>Agents</h2></div><div class="carousel"><div class="agent-card skel"></div></div>
      <div class="section-h"><h2>Activity</h2></div><div class="list"><div class="skel" style="height:300px"></div></div>`;
  }
  async function renderHome() {
    const v = $('#view');
    if (!S.state) v.innerHTML = skelHome();
    try {
      const [st, ch, ac] = await Promise.all([api('/api/state'), api('/api/chart?range=' + S.range), api('/api/activity')]);
      S.state = st; S.chart = ch; S.activity = ac; ok();
    } catch (e) { fail(e); if (!S.state) return; }
    if (!location.hash.startsWith('#/home') && location.hash) return;
    drawHome();
  }
  function drawHome() {
    const st = S.state, v = $('#view');
    if (!$('#home-root')) {
      v.innerHTML = `<div id="home-root">
      <div class="navbar"><a class="icon-btn" href="#/account"><div class="avatar">TF</div></a>
        <div class="title">Grok Bot <span class="chev">›</span></div>
        <button class="icon-btn" id="btn-search" aria-label="Search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg></button>
        <button class="icon-btn" id="btn-bell" aria-label="Pushes"><svg viewBox="0 0 24 24"><path d="M6 17V11a6 6 0 0112 0v6l2 2H4zM10 21h4"/></svg><i class="dot" id="bell-dot" hidden></i></button></div>
      <div class="search" id="search" hidden><input placeholder="Name, symbol or mint" id="search-in"><div id="search-res"></div></div>
      <div class="bal-wrap"><div class="bal-row"><div class="balance" id="bal"></div><span class="pill paper" id="paper-badge">PAPER</span></div>
        <div class="today"><span id="today"></span><span class="pill mult" id="mult"></span></div></div>
      <div class="chart-box"><canvas id="line"></canvas><div class="chart-empty" id="chart-empty" hidden>Waiting for the first trade</div></div>
      <div class="ranges" id="ranges">${['LIVE', '1H', '4H', '1D', '1W', 'ALL'].map(r => `<button data-r="${r}">${r}</button>`).join('')}</div>
      <div class="section-h"><h2 id="agents-h">Agents</h2></div>
      <div class="carousel" id="cards"></div>
      <div class="section-h"><h2>Activity</h2><a href="#/activity">See all</a></div>
      <div class="list" id="act5"></div></div>`;
      $('#ranges').onclick = e => { const r = e.target.dataset.r; if (r) { S.range = r; api('/api/chart?range=' + r).then(c => { S.chart = c; drawHome(); }).catch(fail); } };
      $('#btn-search').onclick = () => { const s = $('#search'); s.hidden = !s.hidden; if (!s.hidden) $('#search-in').focus(); };
      $('#search-in').oninput = debounce(async e => {
        const q = e.target.value.trim(); if (!q) { $('#search-res').innerHTML = ''; return; }
        try {
          let rows = [];
          if (PLAN_B()) {
            const qq = q.toLowerCase();
            const seen = new Set();
            const add = (mint, name, symbol) => { if (!mint || seen.has(mint)) return; seen.add(mint); rows.push({ mint, name, symbol }); };
            (S.activity && S.activity.rows || []).forEach(r => {
              if ((r.mint && r.mint.toLowerCase().includes(qq)) || (r.title && r.title.toLowerCase().includes(qq)) || (r.subtitle && r.subtitle.toLowerCase().includes(qq)))
                add(r.mint, r.title, r.subtitle);
            });
            if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q)) add(q, q, '');
          } else {
            const r = await api('/api/search?q=' + encodeURIComponent(q));
            rows = r.rows || [];
          }
          $('#search-res').innerHTML = rows.length ? `<div class="list" style="margin:8px 0">${rows.map(c => `<a class="row" href="#/coin/${esc(c.mint)}"><div class="mid"><div class="t">${esc(c.name || c.mint)}</div><div class="s">${esc(c.symbol || '')} · ${esc(c.mint.slice(0, 4))}...${esc(c.mint.slice(-4))}</div></div></a>`).join('')}</div>` : `<div class="empty">No coin matches. Paste the mint.</div>`;
        } catch (err) { fail(err); }
      }, 250);
      $('#btn-bell').onclick = () => { if (!PLAN_B()) api('/api/pushes/read', { method: 'POST' }).catch(() => {}); $('#bell-dot').hidden = true; location.hash = '#/activity'; };
    }
    odometer($('#bal'), usd(st.balance));
    $('#paper-badge').hidden = st.mode !== 'PAPER';
    const t = $('#today'); t.textContent = pct(st.todayPct) + ' today'; t.className = st.todayPct >= 0 ? 'up' : 'down';
    $('#mult').textContent = st.multiplier.toFixed(2) + '×';
    $('#bell-dot').hidden = !st.unread;
    document.querySelectorAll('#ranges button').forEach(b => b.classList.toggle('on', b.dataset.r === S.range));
    const flat = !(S.chart.marks || []).length && new Set((S.chart.points || []).map(p => p[1])).size <= 1;
    $('#chart-empty').hidden = !flat;
    Charts.line($('#line'), flat ? { points: [], marks: [], start: S.chart.start } : S.chart);
    $('#agents-h').textContent = `Agents · ${st.agents.filter(a => a.running && a.alive).length} running`;
    $('#cards').innerHTML = st.agents.map(agentCard).join('');
    drawCardCanvases();
    const rows = S.activity.rows.slice(0, 5);
    $('#act5').innerHTML = rows.length ? rows.map(actRow).join('') : `<div class="empty">Nothing yet tonight</div>`;
  }
  function debounce(f, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; }

  const COLORS = { scanner: 'var(--cyan)', auditor: '#fff', analyst: 'var(--yellow)', executor: 'var(--green)', risk: 'var(--pink)' };
  function statusCls(a) { return !a.alive ? 'down' : a.running ? '' : 'paused'; }
  function agentCard(a) {
    let big = '', sub = '', body = '';
    if (a.name === 'scanner') {
      big = `${a.count} pools`; sub = `${a.waiting} in the waiting room`;
      body = a.feed.length ? a.feed.slice(0, 6).map(f => f.verdict === 'kill'
        ? `<div class="feed-row killed"><span class="l">${esc(f.name)}</span><span class="r">${esc(f.reason)}</span></div>`
        : `<div class="feed-row"><span class="l">${esc(f.name)} · liq ${kusd(f.liq)}</span><span class="r" style="color:var(--cyan)">→ auditor</span></div>`).join('')
        : `<div class="empty" style="padding:30px 0">Listening for graduations</div>`;
    } else if (a.name === 'auditor') {
      big = `${a.count} taken apart`; sub = `${a.rejected} rejected`;
      const L = (a.last && a.last.layers) || [];
      const names = ['Mint', 'Freeze', 'Dev', 'Top 10', 'LP', 'Age', 'Bundles', 'Delegates'];
      body = `<div class="strips">${names.map((n, i) => { const l = L.find(x => x.n === i + 1); const c = a.current && !l ? 'reading' : !l ? '' : l.pass === true ? 'ok' : l.pass === false ? 'bad' : ''; return `<div class="strip-l ${c}">${n}</div>`; }).join('')}</div>
        <div class="sub" style="margin-top:12px">${a.current ? `taking apart ${esc(a.currentName)}...` : a.last ? (L.every(l => l.pass) ? `${esc(a.last.name)} · 8/8 → Executor` : `${esc(a.last.name)} · ${esc((L.find(l => l.pass === false) || {}).value || '')}`) : 'No coin taken apart yet'}</div>`;
    } else if (a.name === 'analyst') {
      big = 'Scoring'; sub = a.lastName ? `${esc(a.lastName)} · ${a.mode === 'rules' ? 'rules' : 'Jev'}` : (a.mode === 'rules' ? 'rules mode' : 'Jev mode');
      body = `<div class="ring-wrap"><canvas class="ring" data-score="${a.score == null ? '' : a.score}" data-min="${a.minScore}"></canvas></div>`;
    } else if (a.name === 'executor') {
      big = `${a.count} trades`; sub = a.last ? `${usd(a.last.size)} · ${a.last.pct}% of stack` : `${a.stackPct}% of stack per trade`;
      const done = a.last && a.last.status === 'bought';
      const p = a.last ? Math.min(100, Math.round((Date.now() / 1000 - a.last.ts) / 1.2 * 100)) : 0;
      body = a.last ? `<div class="sub">${esc(a.last.name)}</div><div class="bar"><i style="width:${done ? 100 : p}%"></i></div><div class="sub" style="margin-top:8px">${done ? '✓ Filled' : `Executing... ${p}%`}</div>` : `<div class="empty" style="padding:30px 0">No trades yet</div>`;
    } else if (a.name === 'risk') {
      big = a.open ? 'Guarding' : (a.lastExit || 'Idle'); sub = a.open ? `${a.open} open` : 'Nothing open';
      body = `<div class="pills"><span class="pill mono red">stop -${a.stopPct}%</span><span class="pill mono green">trail ${a.trailPct}%</span></div>${a.lastExit ? `<div class="sub" style="margin-top:12px">Last exit: ${esc(a.lastExit)}</div>` : ''}`;
    }
    return `<div class="agent-card"><div class="head"><span class="name" style="color:${COLORS[a.name]}">${a.title}</span><i class="status ${statusCls(a)}"></i></div>
      <div class="big">${big}</div><div class="sub">${sub}</div><div class="body">${body}</div></div>`;
  }
  function drawCardCanvases() { document.querySelectorAll('canvas.ring').forEach(c => Charts.ring(c, c.dataset.score === '' ? null : +c.dataset.score, +c.dataset.min)); }

  function actRow(r) {
    const ico = { bought: '↓', sold: '↑', stopped: '×', rejected: '–' }[r.kind] || '·';
    const col = r.kind === 'sold' ? (r.value.startsWith('+') ? 'up' : 'down') : r.kind === 'stopped' ? 'down' : r.kind === 'rejected' ? 'sec' : '';
    const href = r.kind === 'rejected' ? (r.agent === 'auditor' ? `#/audit/${esc(r.mint)}` : `#/coin/${esc(r.mint)}`) : `#/coin/${esc(r.mint)}`;
    const sub = r.kind === 'bought' ? r.subtitle : r.subtitle;
    return `<a class="row" href="${href}"><div class="ico">${ico}</div><div class="mid"><div class="t">${esc(r.title)}</div><div class="s">${esc(sub)} · ${tm(r.ts)}</div></div><div class="v ${col}">${esc(r.value)}</div></a>`;
  }

  // ---- AGENTS TAB ----
  async function renderAgents() {
    const v = $('#view');
    v.innerHTML = `<h1 class="page-title">Agents</h1>` + [1, 2, 3].map(() => `<div class="full-card skel" style="height:220px"></div>`).join('');
    let st, decs;
    try {
      st = await api('/api/state'); S.state = st;
      decs = await Promise.all(st.agents.map(a => api(`/api/agents/${a.name}/decisions`)));
      ok();
    } catch (e) { fail(e); if (!S.state) return; st = S.state; decs = st.agents.map(a => ({ decisions: S['dec_' + a.name] || [] })); }
    if (!location.hash.startsWith('#/agents')) return;
    const openPos = st.agents.find(a => a.name === 'risk').open > 0;
    v.innerHTML = `<h1 class="page-title">Agents</h1>` + st.agents.map((a, i) => {
      const d = decs[i].decisions || []; S['dec_' + a.name] = d;
      const locked = a.name === 'risk' && openPos;
      return `<div class="full-card"><div class="top"><span class="status ${statusCls(a)}" style="width:8px;height:8px;border-radius:4px;display:inline-block;background:${!a.alive ? 'var(--red)' : a.running ? 'var(--green)' : 'var(--ter)'}"></span>
        <span class="name" style="color:${COLORS[a.name]}">${a.title}</span><span class="sec">${a.count} today</span>
        <button class="switch ${a.running ? 'on' : ''} ${locked ? 'locked' : ''}" data-agent="${a.name}" ${locked ? 'disabled title="Locked while a position is open"' : ''} aria-label="pause/resume"></button></div>
        <div style="margin-top:10px">${d.length ? d.map(x => `<div class="dec"><span class="sec">${tm(x.ts)}</span><a class="c" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a><span class="why ${/pass|bought|sent|trail/.test(x.verdict) ? 'up' : ''}">${esc(x.verdict)} · ${esc(x.reason || '')}</span></div>`).join('') : `<div class="empty" style="padding:14px">${a.name === 'scanner' ? 'Listening for graduations' : a.name === 'auditor' ? 'No coin taken apart yet' : 'Nothing yet tonight'}</div>`}</div>
        <a class="link-btn" href="#/account" data-group="${a.name}">Settings</a></div>`;
    }).join('');
    v.querySelectorAll('.switch').forEach(b => b.onclick = async () => {
      const name = b.dataset.agent, on = b.classList.contains('on');
      try { await api(`/api/agents/${name}/${on ? 'pause' : 'resume'}`, { method: 'POST' }); b.classList.toggle('on'); } catch (e) { toast(e.message); }
    });
  }

  // ---- ACTIVITY ----
  async function renderActivity() {
    const v = $('#view');
    v.innerHTML = `<h1 class="page-title">Activity</h1><div class="list"><div class="skel" style="height:400px"></div></div>`;
    let rows = [], next = null;
    try { const r = await api('/api/activity'); rows = r.rows; next = r.next; S.activity = r; ok(); } catch (e) { fail(e); if (!S.activity) return; rows = S.activity.rows; }
    const draw = () => { v.innerHTML = `<h1 class="page-title">Activity</h1><div class="list">${rows.length ? rows.map(actRow).join('') : '<div class="empty">Nothing yet tonight</div>'}</div>${next ? '<div style="text-align:center"><button class="link-btn" id="more">Load more</button></div>' : ''}`;
      const mo = $('#more'); if (mo) mo.onclick = async () => { const r = await api('/api/activity?before=' + next); rows = rows.concat(r.rows); next = r.next; draw(); }; };
    if (location.hash.startsWith('#/activity')) draw();
  }

  // ---- COIN SCREEN ----
  async function renderCoin(mint) {
    const sh = $('#sheet');
    sh.innerHTML = `<button class="back" onclick="history.back()">‹ Back</button><div class="skel" style="height:40px;margin:8px 16px"></div><div class="skel" style="height:80px;margin:8px 16px"></div><div class="skel" style="height:260px;margin:8px 16px"></div>`;
    let c;
    try { c = await api('/api/coin/' + encodeURIComponent(mint)); S['coin_' + mint] = c; ok(); } catch (e) { fail(e); c = S['coin_' + mint]; if (!c) return; }
    if (!location.hash.startsWith('#/coin/')) return;
    const p = c.position, x = c.exit;
    sh.innerHTML = `<button class="back" onclick="history.back()">‹ Back</button>
      <div style="padding:4px 16px 0;display:flex;align-items:center;gap:8px"><div style="flex:1"><div style="font-size:22px;font-weight:700;font-family:var(--display)">${esc(c.name || mint.slice(0, 6))}</div>
        <div class="sec" style="font-size:14px">${esc(c.symbol || '')} · Solana · ${ago(c.ageH)}</div></div>
        ${c.mode === 'PAPER' ? '<span class="pill paper">PAPER</span>' : ''}
        ${c.shield ? `<a class="chip ${c.shield === '8/8' ? '' : 'bad'}" href="#/audit/${esc(mint)}">⛨ ${esc(c.shield)}</a>` : ''}</div>
      <div class="price-big">${price(c.price)}</div>
      ${c.sinceEntryPct != null ? `<div style="padding:0 16px" class="${c.sinceEntryPct >= 0 ? 'up' : 'down'}">${c.sinceEntryPct >= 0 ? '▲' : '▼'} ${Math.abs(c.sinceEntryPct).toFixed(2)}% since entry</div>` : ''}
      <div class="chart-box" style="height:260px;margin:12px 16px 14px"><canvas id="candles"></canvas></div>
      <div class="stats"><div><div class="k">Market cap</div><div class="v">${kusd(c.marketCap)}</div></div><div><div class="k">Liquidity</div><div class="v">${kusd(c.liquidity)}</div></div>
        <div><div class="k">24h volume</div><div class="v">${kusd(c.volume24h)}</div></div><div><div class="k">Holders</div><div class="v">${c.holders == null ? 'n/a' : c.holders.toLocaleString()}</div></div></div>
      ${p ? `<div class="section-h"><h2>Your position</h2></div><div class="list"><div class="vrow"><span>${usd(p.sizeUsd)} in · Executor</span><span class="sec">entry ${price(p.entryPrice)}</span></div>
        <div class="vrow"><span class="k">Stop line</span><span class="down">${price(x.stopPrice)} · -${x.stopPct}%</span></div>
        <div class="vrow"><span class="k">Trail line</span><span class="${x.trailActive ? 'up' : 'sec'}">${x.trailActive ? price(x.trailPrice) + ' · ' + x.trailPct + '% off top' : 'starts at ' + price(x.trailStartPrice)}</span></div>
        <div class="vrow"><span class="k">Time left to timeout</span><span>${Math.floor(x.timeoutLeftS / 3600)}h ${Math.floor(x.timeoutLeftS % 3600 / 60)}m</span></div></div>` : ''}
      <a class="cta ${p ? 'sell' : ''}" href="${esc(c.coin_url)}" target="_blank" rel="noopener">${p ? 'Sell on FOMO' : 'Buy on FOMO'}</a>`;
    Charts.candles($('#candles'), c.candles, { exitLine: x ? x.exitLine : null });
  }

  // ---- AUDITOR SCREEN ----
  async function renderAudit(mint) {
    const sh = $('#sheet');
    sh.innerHTML = `<button class="back" onclick="history.back()">‹ Back</button><div class="skel" style="height:330px;width:240px;margin:20px auto;border-radius:120px"></div><div class="list"><div class="skel" style="height:300px"></div></div>`;
    let a;
    try { a = await api('/api/audit/' + encodeURIComponent(mint)); S['audit_' + mint] = a; ok(); } catch (e) { fail(e); a = S['audit_' + mint]; if (!a) return; }
    if (!location.hash.startsWith('#/audit/')) return;
    if (!a.layers.length) {
      sh.innerHTML = `<button class="back" onclick="history.back()">‹ Back</button><div class="verdict-h">${esc(a.name)}</div><div class="empty" style="padding-top:80px">No coin taken apart yet</div>
        <a class="cta" href="${esc(a.coin_url)}" target="_blank" rel="noopener">Open on FOMO</a>`; return;
    }
    const discs = a.layers.map((l, i) => `<div class="disc" id="disc${l.n}" style="top:${i * 38}px;width:${240 - i * 0}px"><span class="mk"></span></div>`).join('');
    sh.innerHTML = `<button class="back" onclick="history.back()">‹ Back</button>
      <div class="verdict-h">${a.passed ? 'Cleared · 8/8 parts' : 'Rejected · ' + esc(a.reason || '')}</div>
      <div class="sec" style="padding:0 16px">${a.passed ? (a.sentUsd ? 'Sent to Executor · ' + usd(a.sentUsd) : 'Sent to Executor') : 'Grok Bot won’t buy ' + esc(a.name)}</div>
      <div class="discs" id="discs">${discs}<div class="beam" id="beam"></div></div>
      <div class="list" id="vals">${a.layers.map(l => `<div class="vrow"><span class="k">${l.n} · ${esc(l.name)}</span><span class="${l.pass === true ? 'up' : l.pass === false ? 'down' : 'ter'}" id="val${l.n}">${reduced() ? esc(l.value) : '…'}</span></div>`).join('')}</div>
      <div class="list" style="margin-top:14px"><div class="vrow"><span>Take apart before buying</span><button class="switch ${a.enabled ? 'on' : ''}" id="aud-toggle" aria-label="Auditor on/off"></button></div></div>
      <a class="cta" href="${esc(a.coin_url)}" target="_blank" rel="noopener">Open on FOMO</a>`;
    animateDiscs(a.layers);
    $('#aud-toggle').onclick = auditorToggle;
  }
  // beam: 350ms per layer top to bottom, then 150ms to green or red. Never shows a result the server didn't send.
  function animateDiscs(layers) {
    const beam = $('#beam');
    const paint = l => { const d = $('#disc' + l.n); if (!d) return; d.className = 'disc ' + (l.pass === true ? 'ok' : l.pass === false ? 'bad' : 'grey');
      d.querySelector('.mk').textContent = l.pass === true ? '✓' : l.pass === false ? '✗' : '–'; const v = $('#val' + l.n); if (v) v.textContent = l.value; };
    if (reduced()) { layers.forEach(paint); return; }
    beam.style.display = 'block';
    let i = 0;
    const step = () => {
      if (i >= layers.length) { beam.style.display = 'none'; return; }
      const l = layers[i]; beam.style.top = (i * 38 + 15) + 'px';
      setTimeout(() => { setTimeout(() => { paint(l); i++; step(); }, 150); }, 350);
    };
    step();
  }
  async function auditorToggle() {
    const b = $('#aud-toggle'), on = b.classList.contains('on');
    if (on) {
      if (!confirm('Turn off the Auditor? Coins would go to the Analyst without the 8 safety layers.')) return;
      if (!confirm('Are you sure? This removes the safety check before buying.')) return;
    }
    try { await api('/api/settings', { method: 'POST', body: { key: 'auditor.enabled', value: !on, confirm: on ? 'OFF' : undefined } }); b.classList.toggle('on'); } catch (e) { toast(e.message); }
  }

  // ---- ACCOUNT ----
  async function renderAccount() {
    const v = $('#view');
    v.innerHTML = `<h1 class="page-title">Account</h1><div class="list"><div class="skel" style="height:200px"></div></div><div class="list" style="margin-top:14px"><div class="skel" style="height:400px"></div></div>`;
    let a;
    try { a = await api('/api/account'); S.account = a; ok(); } catch (e) { fail(e); a = S.account; if (!a) return; }
    if (!location.hash.startsWith('#/account')) return;
    const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    const ro = PLAN_B();
    v.innerHTML = `<h1 class="page-title">Account</h1>
      <div class="sec" style="padding:0 16px 8px;font-size:12px">build ${esc(BUILD)}${PLAN_B() ? ' · plan B' : ''}</div>
      <div class="list">
        <div class="vrow"><span>Mode</span><div class="seg" id="mode-seg"><button class="${a.mode === 'PAPER' ? 'on' : ''}" data-m="PAPER">PAPER</button><button class="${a.mode === 'LIVE' ? 'on' : ''}" data-m="LIVE">LIVE</button></div></div>
        <div class="vrow"><span>${a.mode === 'PAPER' ? 'PAPER balance' : 'LIVE stack'}</span>${a.mode === 'LIVE' && !ro ? `<input class="field" id="stack-in" type="number" value="${a.stack}">` : `<span>${usd(a.stack)}</span>`}</div>
        ${a.ticket && a.ticket.message ? `<div class="vrow"><span class="sec" style="font-size:13px">${esc(a.ticket.message)}</span></div>` : ''}
        <a class="vrow" href="${esc(a.profile_url)}" target="_blank" rel="noopener"><span>Your FOMO profile</span><span class="sec">@${esc(a.fomo_handle)} ›</span></a>
        <button class="vrow" style="width:100%" id="invite"><span>Invite a friend</span><span class="sec">›</span></button>
      </div>
      <div class="set-group"><h3>Notifications</h3><div class="list">
        <div class="vrow"><span>Telegram ${esc(a.telegram.bot)}</span><span class="${a.telegram.connected ? 'up' : 'down'}">${a.telegram.connected ? 'Connected' : 'Not connected'}</span></div>
        ${ro ? '' : '<button class="vrow" style="width:100%" id="testpush"><span>Send test push</span><span class="sec">›</span></button>'}
        ${a.plan === 'B' ? '<div class="vrow"><span class="sec">Web push needs plan A hosting · Telegram only</span></div>' : standalone ? '<button class="vrow" style="width:100%" id="enable-push"><span>Enable notifications</span><span class="sec">›</span></button>' : ''}
      </div></div>
      ${Object.entries(a.groups).map(([g, items]) => `<div class="set-group"><h3>${g === 'rules' ? 'Analyst (rules)' : g[0].toUpperCase() + g.slice(1)}</h3><div class="list">${items.filter(s => s.key !== 'desk.mode').map(s => setRow(s, ro)).join('')}</div></div>`).join('')}
      ${ro ? '<div class="empty">Settings are read-only here. Change them with Telegram commands, e.g. "set stop to -8%".</div>' : ''}`;
    $('#invite').onclick = async () => {
      if (navigator.share) { try { await navigator.share({ url: a.SIGNUP_URL, title: 'FOMO' }); } catch (_) {} }
      else { try { await navigator.clipboard.writeText(a.SIGNUP_URL); } catch (_) {} toast('Link copied'); }
    };
    const tp = $('#testpush'); if (tp) tp.onclick = async () => { try { const r = await api('/api/testpush', { method: 'POST' }); toast(r.ok ? 'Test push sent' : 'Push failed'); } catch (e) { toast(e.message); } };
    const ep = $('#enable-push'); if (ep) ep.onclick = () => enablePush(a.vapidPublicKey);
    $('#mode-seg').onclick = async e => {
      const m = e.target.dataset.m; if (!m || ro) return;
      let body = { mode: m };
      if (m === 'LIVE') { const t = prompt('Type LIVE to switch. Money only moves when you tap Buy on FOMO.'); if (t !== 'LIVE') return; body.confirm = 'LIVE'; }
      try { await api('/api/mode', { method: 'POST', body }); renderAccount(); } catch (err) { toast(err.message); }
    };
    const si = $('#stack-in'); if (si) si.onchange = () => saveSetting('desk.stack', si.value);
    v.querySelectorAll('[data-key]').forEach(el => {
      const key = el.dataset.key;
      const commit = val => saveSetting(key, val, el);
      if (el.type === 'range') el.oninput = () => { const f = v.querySelector(`input[data-num="${key}"]`); if (f) f.value = el.value; };
      el.onchange = () => commit(el.type === 'checkbox' ? el.checked : el.value);
    });
  }
  function setRow(s, ro) {
    const dis = ro ? 'disabled' : '';
    if (s.type === 'bool') return `<div class="set"><div class="l"><span>${esc(s.label)}</span><input type="checkbox" data-key="${s.key}" ${s.value ? 'checked' : ''} ${dis} style="width:24px;height:24px;accent-color:var(--green)"></div></div>`;
    if (s.choices) return `<div class="set"><div class="l"><span>${esc(s.label)}</span><select data-key="${s.key}" ${dis} class="field" style="width:110px">${s.choices.map(c => `<option ${c === s.value ? 'selected' : ''}>${c}</option>`).join('')}</select></div></div>`;
    if (s.type === 'str') return `<div class="set"><div class="l"><span>${esc(s.label)}</span><input type="text" class="field" data-key="${s.key}" value="${esc(s.value)}" ${dis}></div></div>`;
    const step = s.type === 'int' ? 1 : (s.max <= 1 ? 0.01 : (s.max - s.min) > 1000 ? 100 : 0.5);
    return `<div class="set"><div class="l"><span>${esc(s.label)}</span><input type="number" data-key="${s.key}" data-num="${s.key}" value="${s.value}" min="${s.min}" max="${s.max}" step="any" ${dis}></div>
      <input type="range" data-key="${s.key}" min="${s.min}" max="${s.max}" step="${step}" value="${s.value}" ${dis}></div>`;
  }
  async function saveSetting(key, val, el) {
    try { const r = await api('/api/settings', { method: 'POST', body: { key, value: val } }); toast(r.ticket && r.ticket.message ? r.ticket.message : 'Saved'); }
    catch (e) { toast(e.message); renderAccount(); }
  }
  async function enablePush(pub) {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      const perm = await Notification.requestPermission(); if (perm !== 'granted') { toast('Notifications not allowed'); return; }
      const key = Uint8Array.from(atob(pub.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - pub.length % 4) % 4)), c => c.charCodeAt(0));
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await api('/api/push', { method: 'POST', body: sub.toJSON() }); toast('Notifications on');
    } catch (e) { toast('Could not enable: ' + e.message); }
  }
  function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2600); }

  // ---- live updates: SSE over fetch (token in header, never in a URL) ----
  async function stream() {
    if (PLAN_B() || !TOKEN()) return;
    try {
      const r = await fetch('/api/stream', { headers: { Authorization: 'Bearer ' + TOKEN() } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = (chunk.match(/^event: (.+)$/m) || [])[1]; const data = (chunk.match(/^data: (.+)$/m) || [])[1];
          if (ev && data) onEvent(ev, JSON.parse(data));
        }
      }
    } catch (e) { /* polling covers it */ }
    setTimeout(stream, 3000);
  }
  let refreshT;
  function onEvent(ev, d) {
    ok();
    clearTimeout(refreshT);
    refreshT = setTimeout(() => { if (!location.hash || location.hash.startsWith('#/home')) renderHome(); }, 300);
  }
  // polling fallback every 15s
  setInterval(() => {
    if (S.failN && Date.now() < S.retryAt) return;
    const h = location.hash || '#/home';
    if (h.startsWith('#/home')) renderHome();
  }, 15000);
  setInterval(() => { if (S.failN && Date.now() >= S.retryAt && (location.hash || '#/home').startsWith('#/home')) renderHome(); }, 1000);

  if ('serviceWorker' in navigator && !PLAN_B()) navigator.serviceWorker.register('sw.js').catch(() => {});
  route(); stream();
  // Plan B: poll a bit faster so the home screen stays fresh without SSE
  if (PLAN_B()) setInterval(() => {
    if (S.failN && Date.now() < S.retryAt) return;
    const h = location.hash || '#/home';
    if (h.startsWith('#/home')) renderHome();
    else if (h.startsWith('#/account')) renderAccount();
    else if (h.startsWith('#/agents')) renderAgents();
    else if (h.startsWith('#/activity')) renderActivity();
  }, 20000);
})();
