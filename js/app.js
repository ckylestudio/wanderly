import { DESTINATIONS, ORIGINS, searchPackages, priceBreakdown, findDest, fmt, nightsBetween } from './data.js';
import { initAnalytics, track } from './analytics.js';
import { initAssistant } from './assistant.js';

const fixes = () => (window.WANDERLY_CONFIG || {}).fixes || {};
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const load = (k, d) => { try { const v = localStorage.getItem('wl_' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem('wl_' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } };

const state = {
  user: load('user', null),
  users: load('users', {}),
  bookings: load('bookings', []),
  draft: load('draft', null),
  lastFrom: load('lastFrom', ORIGINS[0]),
  filters: { maxPrice: 5000, stops: { 0: true, 1: true, 2: true } },
  sort: 'recommended'
};
const defaultFilters = () => ({ maxPrice: 5000, stops: { 0: true, 1: true, 2: true } });
const filtersChanged = () => state.filters.maxPrice < 5000 || Object.values(state.filters.stops).some(v => !v);

const app = $('#app');
let assistant;
let routeToken = 0;

export function navigate(hash) { if (location.hash === hash) route(); else location.hash = hash; }
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms); }
function parse() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path, q: Object.fromEntries(new URLSearchParams(qs || '')), qs: qs || '' };
}
const shell = (inner, cls = 'wrap') => `<div class="${cls}">${inner}</div>`;
const steps = (n) => `<div class="steps"><span class="${n === 1 ? 'on' : ''}">1 · Travelers</span><span class="${n === 2 ? 'on' : ''}">2 · Payment</span><span class="${n === 3 ? 'on' : ''}">3 · Confirmed</span></div>`;

function updateNav(path) {
  $$('#main-nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + path));
  const s = $('#nav-signin');
  if (state.user) { s.textContent = `Hi, ${state.user.name} · Sign out`; s.setAttribute('href', '#/signout'); } else { s.textContent = 'Sign in'; s.setAttribute('href', '#/signin'); }
}

/* ---------------- Views ---------------- */
function viewHome() {
  document.title = 'Wanderly – AI travel concierge';
  app.innerHTML = `
    <section class="hero"><div class="hero-inner">
      <h1>Tell our AI where you want to go. We'll handle the rest.</h1>
      <p>Flights + hotels, planned and booked in minutes by your personal travel concierge.</p>
      <form class="ai-prompt" id="ai-prompt-form"><input id="ai-prompt-input" placeholder="e.g. A cheap beach week in Europe in June" autocomplete="off"><button class="btn accent" id="ai-prompt-go" type="submit">Plan with AI</button></form>
    </div></section>
    <div style="padding:0 20px"><form class="search-card" id="search-form" novalidate>
      <div id="search-error"></div>
      <div class="search-grid">
        <div><label for="from">From</label><select id="from" name="from">${ORIGINS.map(o => `<option ${o === state.lastFrom ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
        <div><label for="to">To</label><input id="to" name="to" list="dest-list" placeholder="City or destination" autocomplete="off"><datalist id="dest-list">${DESTINATIONS.map(d => `<option value="${d.city}">`).join('')}</datalist></div>
        <div><label for="depart">Depart</label><input id="depart" name="depart" type="date"></div>
        <div><label for="ret">Return</label><input id="ret" name="ret" type="date"></div>
        <div><label for="pax">Travelers</label><select id="pax" name="pax">${[1, 2, 3, 4, 5, 6].map(n => `<option value="${n}" ${n === 2 ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <button class="btn" id="search-btn" type="submit">Search trips</button>
      </div></form></div>
    <div class="wrap"><h2 class="section-title">Trending right now</h2>
      <div class="dest-grid">${DESTINATIONS.slice(0, 8).map(d => `<button class="dest-card" data-city="${d.city}" style="background:linear-gradient(135deg,hsl(${d.hue} 70% 42%),hsl(${(d.hue + 40) % 360} 70% 58%))"><b>${d.emoji} ${d.city}</b><span>${d.country} · from ${fmt(d.base)}</span></button>`).join('')}</div>
    </div>`;
  track('home_viewed');
  $('#ai-prompt-form').addEventListener('submit', (e) => {
    e.preventDefault(); const v = $('#ai-prompt-input').value.trim();
    track('ai_prompt_submitted', { fromHome: true });
    assistant.send(v || 'Surprise me with a trip', { suggested: !v });
  });
  $$('.dest-card').forEach(b => b.addEventListener('click', () => { $('#to').value = b.dataset.city; track('destination_card_clicked', { city: b.dataset.city }); $('#depart').focus(); }));
  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target).entries());
    const errs = [];
    const dest = findDest(v.to);
    const clear = () => { $('#search-error').innerHTML = ''; $$('.field-error').forEach(x => x.classList.remove('field-error')); };
    clear();
    if (!dest) errs.push(['to', fixes().inlineValidation ? `We don't serve "${v.to || 'that'}" yet. Pick a destination from the list.` : 'No results. Please try again.']);
    if (!v.depart || !v.ret || new Date(v.ret) <= new Date(v.depart)) errs.push(['ret', fixes().inlineValidation ? 'Return date must be after your departure date.' : 'Invalid dates.']);
    track('search_submitted', { destination: v.to || '', pax: Number(v.pax), valid: errs.length === 0 });
    if (errs.length) {
      $('#search-error').innerHTML = `<div class="banner error" role="alert">${esc(errs.map(x => x[1]).join(' '))}</div>`;
      errs.forEach(([id]) => $('#' + id).classList.add('field-error'));
      track('validation_error', { form: 'search', fields: errs.map(x => x[0]).join(',') });
      return;
    }
    state.lastFrom = v.from; save('lastFrom', v.from);
    navigate('#/results?' + new URLSearchParams({ from: v.from, to: dest.city, depart: v.depart, ret: v.ret, pax: v.pax }).toString());
  });
}

async function viewResults({ q, qs }) {
  const token = routeToken;
  document.title = `Trips to ${q.to || ''} – Wanderly`;
  app.innerHTML = shell(`<div class="empty"><div style="font-size:40px">🔎</div><p>Searching 400+ airlines and 90,000 hotels…</p></div>`);
  await sleep(900 + Math.random() * 900);
  if (token !== routeToken) return;
  const pax = Number(q.pax || 2);
  const all = searchPackages({ from: q.from, to: q.to, depart: q.depart, ret: q.ret, pax });
  track('results_viewed', { destination: q.to || '', count: all.length, via: q.via || 'search' });
  const draw = () => {
    const f = state.filters;
    let list = all.filter(p => p.perPerson <= f.maxPrice && f.stops[Math.min(2, p.stops)]);
    if (state.sort === 'price') list.sort((a, b) => a.perPerson - b.perPerson);
    if (state.sort === 'rating') list.sort((a, b) => b.rating - a.rating);
    if (state.sort === 'duration') list.sort((a, b) => a.durationH - b.durationH);
    app.innerHTML = shell(`
      <div class="toolbar"><div><h2 style="margin:0">${esc(q.to)} · ${all[0]?.nights || ''} nights</h2><span class="hint">${esc(q.from)} · ${esc(q.depart)} → ${esc(q.ret)} · ${pax} traveler${pax > 1 ? 's' : ''}</span></div>
        <div><label for="sort" style="display:inline">Sort by </label><select id="sort"><option value="recommended">Recommended</option><option value="price">Price</option><option value="rating">Rating</option><option value="duration">Duration</option></select></div></div>
      <div class="results-layout">
        <aside class="panel" id="filters"><h3>Max price per person</h3>
          <input type="range" id="f-price" min="200" max="5000" step="50" value="${f.maxPrice}"><div class="hint" id="f-price-label">Up to ${fmt(f.maxPrice)}</div>
          <h3 style="margin-top:16px">Stops</h3>
          <label class="check"><input type="checkbox" id="f-s0" ${f.stops[0] ? 'checked' : ''}> Nonstop</label>
          <label class="check"><input type="checkbox" id="f-s1" ${f.stops[1] ? 'checked' : ''}> 1 stop</label>
          <label class="check"><input type="checkbox" id="f-s2" ${f.stops[2] ? 'checked' : ''}> 2+ stops</label></aside>
        <section id="pkg-list">${list.length ? list.map(pkgCard).join('') : `<div class="empty"><div style="font-size:40px">🙁</div><p>No trips match your filters.</p><button class="btn ghost" id="clear-filters">Clear filters</button></div>`}</section>
      </div>`);
    $('#sort').value = state.sort;
    $('#sort').addEventListener('change', (e) => {
      const hadFilters = filtersChanged();
      state.sort = e.target.value;
      track('sort_changed', { sort: state.sort, hadFilters });
      if (!fixes().keepFiltersOnSort) { state.filters = defaultFilters(); if (hadFilters) track('filters_lost_on_sort'); }
      draw();
    });
    $('#f-price').addEventListener('input', (e) => { state.filters.maxPrice = Number(e.target.value); $('#f-price-label').textContent = 'Up to ' + fmt(state.filters.maxPrice); });
    $('#f-price').addEventListener('change', () => { track('filter_applied', { type: 'price' }); draw(); });
    [0, 1, 2].forEach(n => $('#f-s' + n).addEventListener('change', (e) => { state.filters.stops[n] = e.target.checked; track('filter_applied', { type: 'stops' }); draw(); }));
    $('#clear-filters')?.addEventListener('click', () => { state.filters = defaultFilters(); draw(); });
    $$('.view-trip').forEach(b => b.addEventListener('click', () => { track('trip_card_clicked', { id: b.dataset.id }); navigate(`#/trip/${b.dataset.id}?${qs}`); }));
    $$('.price-breakdown-link').forEach(el => el.addEventListener('click', () => {
      if (!fixes().priceBreakdownClickable) return; // known bug: looks clickable, does nothing
      const p = all.find(x => x.id === el.dataset.id); showBreakdown(p);
    }));
  };
  draw();
}

function pkgCard(p) {
  return `<article class="pkg" data-id="${p.id}">
    <div class="pkg-img" style="background:linear-gradient(135deg,hsl(${p.hue} 70% 42%),hsl(${(p.hue + 40) % 360} 70% 58%))">${p.emoji}</div>
    <div class="pkg-body"><h3>${esc(p.city)} · ${esc(p.hotel)} ${'★'.repeat(p.stars)}</h3>
      <div class="pkg-meta">✈️ ${esc(p.airline)} · ${p.stops === 0 ? 'Nonstop' : p.stops + ' stop' + (p.stops > 1 ? 's' : '')} · ${p.durationH}h</div>
      <div class="pkg-meta">🏨 ${p.nights} nights · ${p.rating}/10 (${p.reviews.toLocaleString()} reviews)</div>
      <div style="margin-top:8px">${p.refundable ? '<span class="badge green">Free cancellation</span>' : ''}<span class="badge">AI pick</span></div></div>
    <div class="pkg-price"><div class="price">${fmt(p.perPerson)}<small>per person</small></div>
      <div><span class="span-link price-breakdown-link" data-id="${p.id}">Price breakdown</span></div>
      <button class="btn view-trip" data-id="${p.id}">View trip</button></div></article>`;
}

function showBreakdown(p) {
  const b = priceBreakdown(p);
  const m = document.createElement('div'); m.className = 'modal-bg';
  m.innerHTML = `<div class="modal"><h3>Price breakdown</h3>
    <div class="summary-row"><span>Flights + hotel</span><span>${fmt(b.subtotal)}</span></div>
    <div class="summary-row"><span>Taxes &amp; fees</span><span>${fmt(b.taxes)}</span></div>
    <div class="summary-row"><span>Concierge fee</span><span>${fmt(b.concierge)}</span></div>
    <div class="summary-row total"><span>Total</span><span>${fmt(b.total)}</span></div>
    <button class="btn" id="close-modal" style="width:100%;margin-top:10px">Close</button></div>`;
  document.body.appendChild(m);
  $('#close-modal', m).addEventListener('click', () => m.remove());
}

function currentPkg({ path, q }) {
  const id = path.split('/')[2];
  const pax = Number(q.pax || 2);
  return searchPackages({ from: q.from, to: q.to, depart: q.depart, ret: q.ret, pax }).find(p => p.id === id);
}

function viewTrip(r) {
  const p = currentPkg(r);
  if (!p) { app.innerHTML = shell(`<div class="empty"><p>That trip is no longer available.</p><a class="btn" href="#/">Start a new search</a></div>`); return; }
  document.title = `${p.city} trip – Wanderly`;
  const b = priceBreakdown(p);
  const early = fixes().showFeesEarly;
  const mobile = window.innerWidth <= 800;
  const bug = mobile && !fixes().mobileCtaFix;
  track('trip_viewed', { id: p.id, destination: p.city, price: p.base });
  app.innerHTML = shell(`<div class="detail"><div>
      <div class="detail-hero" style="background:linear-gradient(135deg,hsl(${p.hue} 70% 38%),hsl(${(p.hue + 40) % 360} 70% 55%))">${p.emoji}<h1>${esc(p.city)}, ${esc(p.country)}</h1><p>${p.nights} nights · ${esc(p.hotel)} ${'★'.repeat(p.stars)}</p></div>
      <div class="panel"><h3>Your itinerary</h3><ul class="itin">
        <li>✈️ <b>Outbound</b> · ${esc(p.depart)} · ${esc(p.from)} → ${esc(p.city)} · ${esc(p.airline)} · ${p.stops === 0 ? 'Nonstop' : p.stops + ' stop(s)'} · ${p.durationH}h</li>
        <li>🏨 <b>${esc(p.hotel)}</b> · ${p.nights} nights · breakfast ${p.stars >= 4 ? 'included' : 'available'}</li>
        <li>✈️ <b>Return</b> · ${esc(p.ret)} · ${esc(p.city)} → ${esc(p.from)}</li>
        <li>✨ <b>AI concierge</b> · Personalized activity plan after booking</li></ul></div></div>
    <aside class="panel" style="align-self:start"><h3>Price summary</h3>
      <div class="summary-row"><span>${p.pax} × traveler</span><span>${fmt(b.subtotal)}</span></div>
      ${early ? `<div class="summary-row"><span>Taxes &amp; fees</span><span>${fmt(b.taxes)}</span></div><div class="summary-row"><span>Concierge fee</span><span>${fmt(b.concierge)}</span></div>` : ''}
      <div class="summary-row total"><span>Total</span><span>${fmt(early ? b.total : b.subtotal)}</span></div>
      ${early ? '' : '<div class="hint">+ taxes &amp; fees</div>'}
      <div class="${bug ? 'sticky-cta' : ''}" style="margin-top:14px"><button class="btn accent" id="select-trip" style="width:100%;height:52px">Select &amp; continue</button></div>
    </aside></div>`);
  if (bug) { const bar = document.createElement('div'); bar.className = 'mobile-bar'; bar.id = 'mobile-bar'; bar.textContent = '🔒 Secure booking · Price guarantee'; document.body.appendChild(bar); }
  $('#select-trip').addEventListener('click', () => {
    state.draft = { pkg: p, qs: r.qs }; save('draft', state.draft);
    track('trip_selected', { id: p.id, price: p.base });
    if (!state.user && !fixes().guestCheckout) { navigate('#/signin?next=' + encodeURIComponent('/checkout/travelers')); return; }
    navigate('#/checkout/travelers');
  });
}

function viewSignin({ q }) {
  document.title = 'Sign in – Wanderly';
  let mode = q.mode || 'signin';
  const next = q.next ? decodeURIComponent(q.next) : '/';
  track('signin_viewed', { gated: !!q.next });
  const draw = (err = '', email = '', offerSignup = false) => {
    app.innerHTML = shell(`<div class="auth-box panel">
      ${q.next ? '<div class="banner info">Sign in to continue to checkout.</div>' : ''}
      <div class="tabs"><button class="btn ${mode === 'signin' ? '' : 'ghost'}" id="tab-signin" type="button">Sign in</button><button class="btn ${mode === 'signup' ? '' : 'ghost'}" id="tab-signup" type="button">Create account</button></div>
      <form id="auth-form" novalidate>${err ? `<div class="banner error" role="alert">${esc(err)}${offerSignup ? ' <button class="link-like" id="error-signup" type="button">Create account</button>' : ''}</div>` : ''}
        ${mode === 'signup' ? '<div style="margin-bottom:12px"><label for="name">First name</label><input id="name" name="name"></div>' : ''}
        <div style="margin-bottom:12px"><label for="email">Email</label><input id="email" name="email" type="email" value="${esc(email)}"></div>
        <div style="margin-bottom:12px"><label for="password">Password</label><input id="password" name="password" type="password">
          ${mode === 'signup' ? '<div class="hint">At least 10 characters, with a number and a symbol.</div>' : ''}</div>
        <button class="btn" id="auth-submit" type="submit" style="width:100%">${mode === 'signup' ? 'Create account' : 'Sign in'}</button></form>
      ${q.next ? '<div class="hint" style="margin-top:12px;text-align:center">Created your account on another device or browser? You can book without signing in.</div><button class="btn ghost" id="continue-guest" type="button" style="width:100%;margin-top:12px">Continue as guest</button>' : ''}</div>`);
    $('#continue-guest')?.addEventListener('click', () => { track('guest_checkout_chosen'); navigate('#' + next); });
    $('#tab-signin').addEventListener('click', () => { mode = 'signin'; draw(); });
    $('#tab-signup').addEventListener('click', () => { mode = 'signup'; draw(); });
    $('#error-signup')?.addEventListener('click', () => { mode = 'signup'; draw('', email); });
    $('#auth-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(e.target).entries());
      const emailOk = /^\S+@\S+\.\S+$/.test(v.email || '');
      if (mode === 'signup') {
        const pwOk = (v.password || '').length >= 10 && /\d/.test(v.password) && /[^A-Za-z0-9]/.test(v.password);
        if (!emailOk || !pwOk) { track('validation_error', { form: 'signup', fields: (!emailOk ? 'email,' : '') + (!pwOk ? 'password' : '') }); return draw(!emailOk ? 'Enter a valid email address.' : 'Password needs 10+ characters, a number and a symbol.', v.email); }
        state.users[v.email] = { password: v.password, name: v.name || v.email.split('@')[0] }; save('users', state.users);
        state.user = { email: v.email, name: state.users[v.email].name }; save('user', state.user);
        track('signup_completed'); updateNav('/'); navigate('#' + next);
      } else {
        const u = state.users[v.email];
        if (!emailOk || !u || u.password !== v.password) { track('signin_failed'); return draw('That email and password don\'t match an account. Check them and try again, or create an account.', v.email, true); }
        state.user = { email: v.email, name: u.name }; save('user', state.user);
        track('signin_completed'); updateNav('/'); navigate('#' + next);
      }
    });
  };
  draw();
}

function viewTravelers() {
  const d = state.draft;
  if (!d) return navigate('#/');
  const p = d.pkg; document.title = 'Traveler details – Wanderly';
  const b = priceBreakdown(p); const early = fixes().showFeesEarly; const inline = fixes().inlineValidation;
  track('checkout_started', { id: p.id, price: p.base });
  const travelers = Array.from({ length: p.pax }, (_, i) => `<div class="traveler"><b>Traveler ${i + 1}</b><div class="form-grid" style="margin-top:10px">
      <div><label for="t${i}-first">First name</label><input id="t${i}-first" name="first${i}"></div>
      <div><label for="t${i}-last">Last name</label><input id="t${i}-last" name="last${i}"></div>
      <div><label for="t${i}-dob">Date of birth</label><input id="t${i}-dob" name="dob${i}" type="date"></div>
      <div><label for="t${i}-passport">Passport number</label><input id="t${i}-passport" name="passport${i}" ${inline ? 'placeholder="XA1234567"' : ''}>${inline ? '<div class="hint">2 letters followed by 7 digits</div>' : ''}</div></div></div>`).join('');
  app.innerHTML = shell(`${steps(1)}<div class="detail"><form id="travelers-form" novalidate><div id="form-error"></div>${travelers}<button class="btn accent" id="continue-payment" type="submit">Continue to payment</button></form>
    <aside class="panel" style="align-self:start"><h3>${esc(p.city)} trip</h3><div class="summary-row"><span>${p.pax} traveler(s)</span><span>${fmt(b.subtotal)}</span></div>
    ${early ? `<div class="summary-row"><span>Taxes &amp; fees</span><span>${fmt(b.taxes)}</span></div><div class="summary-row"><span>Concierge fee</span><span>${fmt(b.concierge)}</span></div>` : ''}
    <div class="summary-row total"><span>Total</span><span>${fmt(early ? b.total : b.subtotal)}</span></div></aside></div>`);
  const validate = () => {
    const errs = [];
    $$('.field-error').forEach(x => x.classList.remove('field-error')); $$('.err-msg').forEach(x => x.remove());
    for (let i = 0; i < p.pax; i++) {
      const chk = (id, ok, msg) => { if (!ok) { errs.push(id); const el = $('#' + id); el.classList.add('field-error'); if (inline || true) el.insertAdjacentHTML('afterend', `<div class="err-msg">${msg}</div>`); } };
      chk(`t${i}-first`, $(`#t${i}-first`).value.trim().length > 0, inline ? 'Enter a first name' : 'Required');
      chk(`t${i}-last`, $(`#t${i}-last`).value.trim().length > 0, inline ? 'Enter a last name' : 'Required');
      const dob = $(`#t${i}-dob`).value;
      chk(`t${i}-dob`, !!dob && new Date(dob) < new Date(), inline ? 'Enter a valid date of birth' : 'Invalid');
      chk(`t${i}-passport`, /^[A-Z]{2}\d{7}$/.test($(`#t${i}-passport`).value), inline ? 'Use 2 capital letters and 7 digits, e.g. XA1234567' : 'Invalid');
    }
    return errs;
  };
  if (inline) $$('input[id$="-passport"]').forEach(i => { i.addEventListener('input', () => { i.value = i.value.toUpperCase(); }); i.addEventListener('blur', validate); });
  $('#travelers-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const errs = validate();
    if (errs.length) {
      $('#form-error').innerHTML = `<div class="banner error" role="alert">${inline ? 'Please fix the highlighted fields.' : 'Please fix the errors below.'}</div>`;
      track('validation_error', { form: 'travelers', fields: [...new Set(errs.map(x => x.split('-')[1]))].join(',') });
      return;
    }
    state.draft.travelers = Array.from({ length: p.pax }, (_, i) => ({ first: $(`#t${i}-first`).value, last: $(`#t${i}-last`).value })); save('draft', state.draft);
    track('travelers_submitted'); navigate('#/checkout/payment');
  });
}

function viewPayment() {
  const d = state.draft; if (!d || !d.travelers) return navigate('#/');
  const p = d.pkg; document.title = 'Payment – Wanderly';
  let b = priceBreakdown(p); let discount = 0; let processing = false;
  track('payment_viewed', { surpriseFees: !fixes().showFeesEarly, total: b.total });
  const draw = () => {
    const total = b.total - discount;
    $('#pay-summary').innerHTML = `<h3>${esc(p.city)} trip</h3>
      <div class="summary-row"><span>${p.pax} traveler(s)</span><span>${fmt(b.subtotal)}</span></div>
      <div class="summary-row"><span>Taxes &amp; fees</span><span>${fmt(b.taxes)}</span></div>
      <div class="summary-row"><span>Concierge fee</span><span>${fmt(b.concierge)}</span></div>
      ${discount ? `<div class="summary-row" style="color:var(--good)"><span>Promo</span><span>−${fmt(discount)}</span></div>` : ''}
      <div class="summary-row total"><span>Total</span><span>${fmt(total)}</span></div>`;
    $('#pay-btn').textContent = 'Pay ' + fmt(total);
  };
  app.innerHTML = shell(`${steps(2)}<div class="detail"><form id="pay-form" class="panel" novalidate><div id="pay-error"></div>
      <h3>Payment details</h3>
      <div class="form-grid"><div style="grid-column:span 2"><label for="card">Card number</label><input id="card" inputmode="numeric" placeholder="1234 5678 9012 3456" autocomplete="off"></div>
        <div><label for="exp">Expiry</label><input id="exp" placeholder="MM/YY" autocomplete="off"></div><div><label for="cvc">CVC</label><input id="cvc" inputmode="numeric" autocomplete="off"></div>
        <div style="grid-column:span 2"><label for="cardname">Name on card</label><input id="cardname" autocomplete="off"></div></div>
      <div style="display:flex;gap:8px;margin:16px 0;align-items:end"><div style="flex:1"><label for="promo">Promo code</label><input id="promo" autocomplete="off"></div><button class="btn ghost" id="apply-promo" type="button">Apply</button></div>
      <div id="promo-msg" class="hint"></div>
      <button class="btn accent" id="pay-btn" type="submit" style="width:100%;height:52px;margin-top:10px">Pay</button></form>
    <aside class="panel" style="align-self:start" id="pay-summary"></aside></div>`);
  draw();
  $('#apply-promo').addEventListener('click', () => {
    const code = $('#promo').value.trim();
    track('promo_applied', { code });
    if (code === 'WANDER10') { discount = Math.round(b.subtotal * 0.1); $('#promo-msg').textContent = 'Promo applied!'; draw(); return; }
    if (code.toUpperCase() === 'SUMMER') {
      // Known bug: promo config missing -> uncaught TypeError (shows up as a JS error signal).
      const promos = {}; // eslint-disable-line
      discount = Math.round(b.subtotal * promos.SUMMER.percent);
    }
    $('#promo-msg').innerHTML = `<span style="color:var(--bad)">${fixes().inlineValidation ? 'That code isn\'t valid or has expired.' : 'Invalid code.'}</span>`;
  });
  $('#pay-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (processing) { track('payment_double_click'); return; }
    const card = $('#card').value.replace(/\s/g, ''); const exp = $('#exp').value; const cvc = $('#cvc').value;
    if (!/^\d{16}$/.test(card) || !/^\d{2}\/\d{2}$/.test(exp) || !/^\d{3,4}$/.test(cvc) || !$('#cardname').value.trim()) {
      $('#pay-error').innerHTML = `<div class="banner error" role="alert">${fixes().inlineValidation ? 'Check your card number (16 digits), expiry (MM/YY), CVC and name.' : 'Invalid card.'}</div>`;
      track('validation_error', { form: 'payment' }); return;
    }
    processing = true; $('#pay-error').innerHTML = '';
    const total = b.total - discount;
    track('payment_submitted', { total });
    const btn = $('#pay-btn');
    if (fixes().payButtonFeedback) { btn.disabled = true; btn.textContent = 'Processing…'; }
    await sleep(fixes().payButtonFeedback ? 1800 + Math.random() * 1200 : 3500 + Math.random() * 3000);
    const declined = card.startsWith('4000'); const flaky = Math.random() < 0.12;
    if (declined || flaky) {
      track('payment_failed', { reason: declined ? 'declined' : 'error_5021' });
      toast(declined ? 'Card declined.' : 'Payment failed (error 5021)', fixes().payButtonFeedback ? 6000 : 2200);
      if (fixes().payButtonFeedback) { btn.disabled = false; draw(); }
      processing = false; return;
    }
    const booking = { ref: 'WL-' + Math.random().toString(36).slice(2, 8).toUpperCase(), city: p.city, emoji: p.emoji, hotel: p.hotel, depart: p.depart, ret: p.ret, pax: p.pax, total, at: Date.now() };
    state.bookings.unshift(booking); save('bookings', state.bookings); state.draft = null; save('draft', null);
    track('booking_completed', { value: total, destination: p.city, pax: p.pax });
    navigate('#/confirmation/' + booking.ref);
  });
}

function viewConfirmation({ path }) {
  const ref = path.split('/')[2]; const b = state.bookings.find(x => x.ref === ref) || state.bookings[0];
  document.title = 'Booking confirmed – Wanderly';
  if (!b) return navigate('#/');
  app.innerHTML = shell(`${steps(3)}<div class="confirm"><div class="ok">🎉</div><h1>You're going to ${esc(b.city)}!</h1><p>Booking reference <span class="ref">${esc(b.ref)}</span></p>
    <div class="panel" style="text-align:left;margin:18px 0"><div class="summary-row"><span>${esc(b.hotel)}</span><span>${b.pax} traveler(s)</span></div><div class="summary-row"><span>${esc(b.depart)} → ${esc(b.ret)}</span><span>${fmt(b.total)}</span></div></div>
    <button class="btn accent" id="plan-ai">✨ Plan my activities with AI</button> <a class="btn ghost" id="view-trips" href="#/trips">View my trips</a></div>`);
  $('#plan-ai').addEventListener('click', () => { track('post_booking_ai_clicked'); assistant.send(`What should I do in ${b.city}?`, { suggested: true }); });
}

function viewTrips() {
  document.title = 'My trips – Wanderly'; track('trips_viewed');
  app.innerHTML = shell(`<h2>My trips</h2>${state.bookings.length ? state.bookings.map(b => `<div class="panel" style="margin-bottom:12px"><b>${b.emoji} ${esc(b.city)}</b> · ${esc(b.depart)} → ${esc(b.ret)} · ${fmt(b.total)} · <span class="ref">${esc(b.ref)}</span></div>`).join('') : '<div class="empty"><div style="font-size:40px">🧳</div><p>No trips yet. Where to first?</p><a class="btn" href="#/">Explore destinations</a></div>'}`);
}

function viewAssistantPage() {
  document.title = 'AI concierge – Wanderly';
  app.innerHTML = shell(`<div class="confirm"><div class="ok">✨</div><h1>Meet your AI concierge</h1><p>Describe your perfect trip in plain English. Wanderly AI finds options, compares prices and books it for you.</p>
    <div class="chips" style="justify-content:center"><button class="chip" data-q="Cheap beach trip">🏖️ Cheap beach trip</button><button class="chip" data-q="Romantic week in Europe">💑 Romantic Europe</button><button class="chip" data-q="Weekend in New York">🗽 Weekend in NYC</button></div></div>`);
  $$('.chip', app).forEach(c => c.addEventListener('click', () => assistant.send(c.dataset.q, { suggested: true })));
  assistant.open('page');
}

/* ---------------- Router ---------------- */
function route() {
  routeToken++;
  $('#mobile-bar')?.remove();
  const r = parse(); const { path } = r;
  updateNav(path);
  window.scrollTo(0, 0);
  track('page_viewed', { path: path.split('/').slice(0, 3).join('/') });
  if (path === '/signout') { state.user = null; save('user', null); toast('Signed out'); return navigate('#/'); }
  if (path === '/' || path === '') return viewHome();
  if (path === '/results') return viewResults(r);
  if (path.startsWith('/trip/')) return viewTrip(r);
  if (path === '/signin') return viewSignin(r);
  if (path === '/checkout/travelers') return viewTravelers();
  if (path === '/checkout/payment') return viewPayment();
  if (path.startsWith('/confirmation/')) return viewConfirmation(r);
  if (path === '/trips') return viewTrips();
  if (path === '/assistant') return viewAssistantPage();
  app.innerHTML = shell('<div class="empty"><h2>Page not found</h2><a class="btn" href="#/">Back home</a></div>');
}

initAnalytics();
assistant = initAssistant({ navigate, getOrigin: () => state.lastFrom });
window.addEventListener('hashchange', route);
route();
