// Thin analytics layer. Works with Pendo / Novus if the agent is present; otherwise no-ops.
// Synthetic traffic injects window.WANDERLY_IDENTITY before the page loads
// (visitor + account + metadata). Real visitors get an anonymous id.

const cfg = window.WANDERLY_CONFIG || {};

function anonId() {
  try {
    let id = localStorage.getItem('wl_anon');
    if (!id) { id = 'anon-' + Math.random().toString(36).slice(2, 10); localStorage.setItem('wl_anon', id); }
    return id;
  } catch (e) { return 'anon-' + Math.random().toString(36).slice(2, 10); }
}

export function getIdentity() {
  const s = window.WANDERLY_IDENTITY;
  if (s && s.visitor) return s;
  return { visitor: { id: anonId() }, account: { id: 'anon-account' } };
}

function loadPendo(apiKey) {
  (function (p, e, n, d, o) {
    let v, w, x, y, z;
    o = p[d] = p[d] || {}; o._q = o._q || [];
    v = ['initialize', 'identify', 'updateOptions', 'pageLoad', 'track', 'trackAgent'];
    for (w = 0, x = v.length; w < x; ++w) (function (m) {
      o[m] = o[m] || function () { o._q[m === v[0] ? 'unshift' : 'push']([m].concat([].slice.call(arguments, 0))); };
    })(v[w]);
    y = e.createElement(n); y.async = true; y.src = 'https://cdn.pendo.io/agent/static/' + apiKey + '/pendo.js';
    z = e.getElementsByTagName(n)[0]; z.parentNode.insertBefore(y, z);
  })(window, document, 'script', 'pendo');
}

export function initAnalytics() {
  const id = getIdentity();
  window.wanderlyIdentity = id;
  if (cfg.pendoApiKey) {
    loadPendo('47028a32-00c2-4d92-bc8c-2167c8f5c6d4');
    window.pendo.initialize({ visitor: id.visitor, account: id.account });
  } else if (window.pendo && window.pendo.initialize && !window.pendo.__wanderlyInit) {
    // Snippet pasted into index.html without initialize() – do it here with our identity.
    try { window.pendo.initialize({ visitor: id.visitor, account: id.account }); window.pendo.__wanderlyInit = true; } catch (e) { /* ignore */ }
  }
}

export function track(name, props = {}) {
  try {
    if (window.pendo && typeof window.pendo.track === 'function') window.pendo.track(name, props);
  } catch (e) { /* ignore */ }
  (window.__wanderlyEvents = window.__wanderlyEvents || []).push({ name, props, t: Date.now() });
}

// Conversational AI agent events ("prompt" | "agent_response" | "user_reaction").
export function trackAgent(eventType, metadata) {
  try {
    if (window.pendo && typeof window.pendo.trackAgent === 'function') window.pendo.trackAgent(eventType, metadata);
  } catch (e) { /* ignore */ }
}

export function newId(prefix) {
  try {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  } catch (e) { /* ignore */ }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
