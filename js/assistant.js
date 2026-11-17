// "Wanderly AI" – a fake AI concierge. Deliberately imperfect: slow, sometimes errors,
// sometimes irrelevant, and its "Book this" button silently fails ~30% of the time.
import { DESTINATIONS, findDest, futureDate, fmt } from './data.js';
import { track } from './analytics.js';

const cfg = () => (window.WANDERLY_CONFIG || {}).fixes || {};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const KEYWORDS = ['beach', 'cheap', 'budget', 'weekend', 'europe', 'asia', 'family', 'honeymoon', 'romantic', 'couples', 'food', 'nature', 'adventure', 'luxury', 'history', 'nightlife', 'culture', 'wine', 'africa', 'city'];
const ALIAS = { budget: 'cheap', romantic: 'couples' };

function understand(text) {
  const t = text.toLowerCase();
  const dest = findDest(t);
  const tags = KEYWORDS.filter(k => t.includes(k)).map(k => ALIAS[k] || k);
  const budget = (t.match(/\$?\s?(\d{3,5})/) || [])[1];
  return { dest, tags, budget: budget ? Number(budget) : null, t };
}

function reply(text) {
  const u = understand(text);
  if (u.dest) {
    return { text: `${u.dest.emoji} ${u.dest.city} is a great pick! Here's a package I put together for you.`, cards: [u.dest] };
  }
  if (u.tags.length) {
    let pool = DESTINATIONS.filter(d => u.tags.some(t => d.tags.includes(t)));
    if (u.budget) pool = pool.filter(d => d.base <= u.budget);
    pool = pool.slice(0, 3);
    if (pool.length) return { text: `Based on "${u.tags.join(', ')}", these should be a great fit:`, cards: pool };
  }
  // Unhelpful fallback – the model "didn't understand".
  if (cfg().assistantFaster) {
    return { text: "I didn't catch a destination or travel style. Try something like 'warm beach trip in March under $900' – here are some popular ideas:", cards: DESTINATIONS.slice(0, 2) };
  }
  const rnd = DESTINATIONS[Math.floor(Math.random() * DESTINATIONS.length)];
  return { text: "I'm Wanderly AI! Here are some popular destinations travelers love right now.", cards: [rnd], irrelevant: true };
}

export function initAssistant({ navigate, getOrigin }) {
  const launcher = document.getElementById('chat-launcher');
  const panel = document.getElementById('chat-panel');
  let built = false;
  let busy = false;

  function build() {
    panel.innerHTML = `
      <div class="chat-head"><span>✨ Wanderly AI concierge</span><button id="chat-close" aria-label="Close chat">✕</button></div>
      <div class="chat-log" id="chat-log"></div>
      <div class="chips" id="chat-chips" style="padding:0 12px 8px;background:#f4f8fa">
        <button class="chip" data-q="Warm beach trip, cheap">🏖️ Cheap beach trip</button>
        <button class="chip" data-q="Romantic week in Europe">💑 Romantic Europe</button>
        <button class="chip" data-q="Family adventure under 900">👨‍👩‍👧 Family adventure</button>
      </div>
      <form class="chat-form" id="chat-form"><input id="chat-input" placeholder="Where do you want to go?" autocomplete="off"><button class="btn" id="chat-send" type="submit">Send</button></form>`;
    panel.querySelector('#chat-close').addEventListener('click', close);
    panel.querySelector('#chat-form').addEventListener('submit', (e) => { e.preventDefault(); const i = panel.querySelector('#chat-input'); const v = i.value.trim(); if (v) { i.value = ''; send(v); } });
    panel.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => send(c.dataset.q)));
    add('bot', "Hi, I'm Wanderly AI ✨ Tell me about the trip you're dreaming of and I'll find and book it.");
    built = true;
  }

  function add(kind, text, extraHtml = '') {
    const log = panel.querySelector('#chat-log');
    const div = document.createElement('div');
    div.className = 'msg ' + kind;
    div.innerHTML = esc(text) + extraHtml;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  function open(src = 'launcher') {
    if (!built) build();
    panel.hidden = false;
    track('assistant_opened', { source: src });
  }
  function close() { panel.hidden = true; }

  async function send(text) {
    if (busy) return;
    busy = true;
    add('user', text);
    track('assistant_message_sent', { length: text.length });
    const typing = document.createElement('div');
    typing.className = 'typing'; typing.textContent = 'Wanderly AI is thinking…';
    const log = panel.querySelector('#chat-log'); log.appendChild(typing); log.scrollTop = log.scrollHeight;
    const fast = cfg().assistantFaster;
    const started = Date.now();
    await sleep(fast ? 700 + Math.random() * 700 : 1800 + Math.random() * 4200);
    typing.remove();
    busy = false;
    if (Math.random() < (fast ? 0.03 : 0.14)) {
      track('assistant_response_error', { latencyMs: Date.now() - started });
      add('bot err', 'Sorry, something went wrong on my end. Please try again.');
      return;
    }
    const r = reply(text);
    const cardsHtml = r.cards.map(d => `
      <div class="chat-card"><b>${d.emoji} ${esc(d.city)}, ${esc(d.country)}</b>
        <span class="hint">5 nights · flights + hotel from ${fmt(d.base)} pp</span><br>
        <button class="btn small accent book-this" data-dest="${d.code}">Book this</button></div>`).join('');
    const fb = `<div class="fb"><button class="fb-up" aria-label="Helpful">👍</button><button class="fb-down" aria-label="Not helpful">👎</button></div>`;
    const el = add('bot', r.text, cardsHtml + fb);
    track('assistant_response', { latencyMs: Date.now() - started, cards: r.cards.length, relevant: !r.irrelevant });
    el.querySelectorAll('.book-this').forEach(b => b.addEventListener('click', () => {
      const d = DESTINATIONS.find(x => x.code === b.dataset.dest);
      // Known bug: the handler silently does nothing ~30% of the time.
      if (!cfg().assistantBookWorks && Math.random() < 0.3) return;
      track('assistant_book_clicked', { destination: d.code });
      close();
      const q = new URLSearchParams({ from: getOrigin(), to: d.city, depart: futureDate(30), ret: futureDate(35), pax: 2, via: 'ai' });
      navigate('#/results?' + q.toString());
    }));
    el.querySelector('.fb-up').addEventListener('click', () => { track('assistant_feedback', { helpful: true }); el.querySelector('.fb').textContent = 'Thanks for the feedback!'; });
    el.querySelector('.fb-down').addEventListener('click', () => { track('assistant_feedback', { helpful: false }); el.querySelector('.fb').textContent = 'Thanks – we\'ll improve.'; });
  }

  launcher.addEventListener('click', () => (panel.hidden ? open('launcher') : close()));
  return { open, close, send: (t) => { open('prompt'); return send(t); } };
}
