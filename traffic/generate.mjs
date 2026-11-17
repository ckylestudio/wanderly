// Persona-driven synthetic traffic for Wanderly.
// Drives a REAL browser through the live site so the Novus/Pendo agent sees genuine
// clicks, page loads, rage clicks, dead clicks, form errors, JS errors and conversions.
//
//   SITE_URL=https://<user>.github.io/wanderly/ SESSIONS=20 node generate.mjs
import { chromium, devices } from 'playwright';
import fs from 'node:fs';

const SITE_URL = (process.env.SITE_URL || 'http://localhost:8080/').replace(/\/?$/, '/');
const BASE_SESSIONS = Number(process.env.SESSIONS || 24);
const CONCURRENCY = Number(process.env.CONCURRENCY || 3);
const SPEED = Number(process.env.SPEED || 1); // <1 = faster think-times (for local tests)
const VERBOSE = !!process.env.VERBOSE;

const rnd = (a, b) => a + Math.random() * (b - a);
const ri = (a, b) => Math.floor(rnd(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const chance = (p) => Math.random() < p;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const think = (a = 600, b = 2200) => sleep(rnd(a, b) * SPEED);
const wpick = (items) => { let t = items.reduce((s, i) => s + i.w, 0); let r = Math.random() * t; for (const i of items) { if ((r -= i.w) <= 0) return i; } return items[0]; };

/* ---------- synthetic population ---------- */
const CITIES = ['Lisbon', 'Barcelona', 'Rome', 'Paris', 'Tokyo', 'Bangkok', 'Bali', 'Cancún', 'New York', 'Miami', 'Reykjavík', 'Cape Town', 'Dubai', 'Sydney', 'Malé', 'Denver'];
const CITY_W = [10, 9, 8, 8, 8, 6, 7, 7, 8, 7, 3, 2, 4, 3, 3, 3];
const ORIGINS = ['Boston (BOS)', 'New York (JFK)', 'Chicago (ORD)', 'San Francisco (SFO)', 'Austin (AUS)', 'Seattle (SEA)', 'Atlanta (ATL)', 'Los Angeles (LAX)'];
const FIRST = ['Ava', 'Liam', 'Noah', 'Mia', 'Zoe', 'Ethan', 'Isla', 'Kai', 'Nora', 'Leo', 'Maya', 'Omar', 'Priya', 'Sofia', 'Diego', 'Yuki', 'Hana', 'Marcus', 'Elena', 'Tariq'];
const LAST = ['Reyes', 'Nguyen', 'Patel', 'Kim', 'Rossi', 'Haddad', 'Silva', 'Okafor', 'Müller', 'Tanaka', 'Cohen', 'Dubois', 'Larsen', 'Singh', 'Brown'];
const GEO = [
  { country: 'US', tz: 'America/New_York', locale: 'en-US', w: 55 }, { country: 'US', tz: 'America/Los_Angeles', locale: 'en-US', w: 15 },
  { country: 'GB', tz: 'Europe/London', locale: 'en-GB', w: 10 }, { country: 'DE', tz: 'Europe/Berlin', locale: 'de-DE', w: 6 },
  { country: 'JP', tz: 'Asia/Tokyo', locale: 'ja-JP', w: 4 }, { country: 'AU', tz: 'Australia/Sydney', locale: 'en-AU', w: 5 }, { country: 'IN', tz: 'Asia/Kolkata', locale: 'en-IN', w: 5 }
];
const ACCOUNTS = Array.from({ length: 40 }, (_, i) => ({
  id: `acct-${String(i + 1).padStart(3, '0')}`,
  name: ['Northwind', 'Contoso Travel', 'Fabrikam', 'Initech', 'Globex', 'Umbrella', 'Hooli', 'Soylent', 'Stark Ind.', 'Wayne Ent.'][i % 10] + (i >= 10 ? ` ${['East', 'West', 'Labs', 'Group'][Math.floor(i / 10) - 1]}` : ''),
  tier: i < 6 ? 'business' : i < 18 ? 'plus' : 'free',
  industry: ['tech', 'finance', 'health', 'media', 'retail'][i % 5]
}));
const POP = 450;
function visitor(i) {
  const g = (i * 7919) % 100; const geo = GEO.find((x, idx, arr) => g < arr.slice(0, idx + 1).reduce((s, y) => s + y.w, 0)) || GEO[0];
  const acct = i % 5 === 0 ? ACCOUNTS[i % ACCOUNTS.length] : ACCOUNTS[ACCOUNTS.length - 1 - (i % 22)];
  const first = FIRST[i % FIRST.length]; const last = LAST[(i * 3) % LAST.length];
  return { n: i, id: `synth-visitor-${String(i).padStart(4, '0')}`, email: `${first}.${last}.${i}@synthetic.test`.toLowerCase(), first, last, geo, acct };
}
// Zipf-ish: a minority of visitors return often.
const pickVisitor = () => visitor(Math.floor(Math.pow(Math.random(), 1.7) * POP) + 1);

const CHANNELS = [{ w: 34, p: '', ref: '' }, { w: 26, p: 'utm_source=google&utm_medium=organic', ref: 'https://www.google.com/' }, { w: 18, p: 'utm_source=google&utm_medium=cpc&utm_campaign=summer_escapes', ref: 'https://www.google.com/' },
  { w: 10, p: 'utm_source=newsletter&utm_medium=email&utm_campaign=weekly_deals', ref: '' }, { w: 8, p: 'utm_source=instagram&utm_medium=social&utm_campaign=creators', ref: 'https://l.instagram.com/' }, { w: 4, p: 'utm_source=partner&utm_medium=referral', ref: 'https://www.travelblog.example/' }];

/* ---------- personas ----------
 gates = probability to continue past each funnel stage.  */
const PERSONAS = [
  { name: 'window_shopper', w: 33, gates: { search: 0.8, trip: 0.2, select: 0.45, auth: 0.4, travelers: 0.6, pay: 0.5 } },
  { name: 'comparer', w: 16, comparer: true, gates: { search: 0.95, trip: 0.65, select: 0.55, auth: 0.5, travelers: 0.7, pay: 0.5 } },
  { name: 'ai_planner', w: 14, ai: true, gates: { search: 1, trip: 0.6, select: 0.6, auth: 0.5, travelers: 0.7, pay: 0.55 } },
  { name: 'form_fighter', w: 8, fighter: true, gates: { search: 1, trip: 0.7, select: 0.7, auth: 0.6, travelers: 0.5, pay: 0.7 } },
  { name: 'sloppy_searcher', w: 7, sloppy: true, gates: { search: 0.6, trip: 0.7, select: 0.6, auth: 0.6, travelers: 0.7, pay: 0.6 } },
  { name: 'sticker_shock', w: 8, sticker: true, gates: { search: 1, trip: 0.8, select: 0.7, auth: 0.7, travelers: 0.8, pay: 0.8 } },
  { name: 'rage_payer', w: 5, rager: true, gates: { search: 1, trip: 0.8, select: 0.8, auth: 0.7, travelers: 0.8, pay: 1 } },
  { name: 'converter', w: 5, gates: { search: 1, trip: 1, select: 1, auth: 1, travelers: 1, pay: 1 }, patient: true },
  { name: 'returning_user', w: 4, returning: true, gates: { search: 0.9, trip: 0.6, select: 0.6, auth: 0.7, travelers: 0.8, pay: 0.7 } }
];

const AI_PROMPTS = ['Cheap beach trip for two', 'Romantic week in Europe', 'Family adventure under 900', 'Weekend in New York', 'Honeymoon in the Maldives', 'somewhere warm in march??', 'Best food trip in Asia', 'Plan me something fun for next month', 'Luxury city break in Dubai'];

/* ---------- browser helpers ---------- */
async function hclick(page, sel, { yFrac = 0.5, nth = 0 } = {}) {
  const loc = page.locator(sel).nth(nth);
  await loc.evaluate(e => e.scrollIntoView({ block: 'center' }));
  await sleep(120);
  const box = await loc.boundingBox();
  if (!box) throw new Error('no box ' + sel);
  const x = box.x + box.width * rnd(0.35, 0.65); const y = box.y + Math.max(2, box.height * yFrac);
  await page.mouse.move(x - rnd(20, 60), y - rnd(10, 40), { steps: 3 });
  await page.mouse.click(x, y);
}
async function typeInto(page, sel, text, fast = false) {
  const loc = page.locator(sel).first();
  await loc.click(); await loc.fill('');
  if (fast) await loc.fill(text); else await loc.pressSequentially(text, { delay: rnd(15, 55) * SPEED });
}
const hashNow = (page) => page.evaluate(() => location.hash);
const dateStr = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

class Abandon extends Error { constructor(stage) { super('abandon:' + stage); this.stage = stage; } }
const gate = (p, stage) => { if (!chance(p.gates[stage])) throw new Abandon(stage); };

/* ---------- stages ---------- */
async function stageSearch(page, ctx) {
  const { persona: p } = ctx;
  const dest = wpick(CITIES.map((c, i) => ({ c, w: CITY_W[i] }))).c;
  await think();
  if (chance(0.3) && await page.locator(`.dest-card[data-city="${dest}"]`).count()) { await hclick(page, `.dest-card[data-city="${dest}"]`); await think(400, 900); }
  await page.selectOption('#from', pick(ORIGINS)); await think(300, 900);
  let to = dest;
  if (p.sloppy && chance(0.6)) to = dest.slice(0, -1) + 'x'; // typo -> vague error
  await typeInto(page, '#to', to);
  const depart = ri(14, 120); const nights = ri(3, 10);
  let d1 = dateStr(depart); let d2 = dateStr(depart + nights);
  if (p.sloppy && chance(0.5)) { d2 = dateStr(depart - 2); } // return before depart
  await page.fill('#depart', d1); await page.fill('#ret', d2); await think(300, 900);
  await page.selectOption('#pax', String(pick([1, 2, 2, 2, 3, 4])));
  await hclick(page, '#search-btn');
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(500);
    if ((await hashNow(page)).startsWith('#/results')) return;
    // validation error – confusing copy, user retries or leaves
    const hadErr = await page.locator('#search-error .banner').count();
    if (!hadErr) break;
    if (attempt >= 1 && chance(0.55)) throw new Abandon('search_error');
    await think(1200, 2800);
    await typeInto(page, '#to', dest, true); await page.fill('#depart', d1); await page.fill('#ret', dateStr(depart + nights));
    await hclick(page, '#search-btn');
  }
  if (!(await hashNow(page)).startsWith('#/results')) throw new Abandon('search_error');
}

async function stageResults(page, ctx) {
  const { persona: p } = ctx;
  try { await page.waitForSelector('.pkg', { timeout: 9000 }); } catch { throw new Abandon('results_empty'); }
  await think(1200, 3500);
  if (p.comparer) {
    await page.selectOption('#sort', 'price'); await think(500, 1200);
    for (let k = 0; k < ri(1, 2); k++) {
      await page.evaluate((v) => { const e = document.querySelector('#f-price'); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, ri(900, 2200));
      await think(600, 1400);
      await page.locator('#f-s2').uncheck().catch(() => {}); await think(500, 1200);
      await page.selectOption('#sort', pick(['rating', 'duration', 'price'])); // wipes filters unless fixed
      await think(500, 1200);
    }
    // looks clickable, isn't -> dead / rage clicks
    if (await page.locator('.price-breakdown-link').count()) {
      const n = ri(2, 5);
      for (let i = 0; i < n; i++) { await hclick(page, '.price-breakdown-link', { nth: 0 }); await sleep(rnd(90, 220)); }
      if (await page.locator('.modal-bg').count()) await page.locator('#close-modal').click();
    }
  }
  gate(p, 'trip');
  const cards = await page.locator('.view-trip').count();
  if (!cards) throw new Abandon('results_filtered_out');
  await hclick(page, '.view-trip', { nth: ri(0, Math.min(3, cards - 1)) });
  await page.waitForFunction(() => location.hash.startsWith('#/trip/'), null, { timeout: 8000 });
}

async function stageTrip(page, ctx) {
  const { persona: p } = ctx;
  await think(1500, 4500);
  gate(p, 'select');
  const before = await hashNow(page);
  await hclick(page, '#select-trip');
  await sleep(700);
  if ((await hashNow(page)) === before) {
    // Mobile sticky bar covers the CTA: dead clicks, rage, maybe discover the top edge
    for (let i = 0; i < ri(1, 3); i++) { await hclick(page, '#select-trip'); await sleep(rnd(100, 260)); }
    if (chance(0.5)) { await think(800, 1600); await hclick(page, '#select-trip', { yFrac: 0.08 }); await sleep(700); }
    if ((await hashNow(page)) === before) throw new Abandon('mobile_cta_blocked');
  }
}

async function stageAuth(page, ctx) {
  const { persona: p, v } = ctx;
  if (!(await hashNow(page)).startsWith('#/signin')) return; // guest checkout enabled or already signed in
  gate(p, 'auth');
  await think(800, 2000);
  if (p.returning || chance(0.1)) { // tries to sign in with an account that doesn't exist here
    await typeInto(page, '#email', v.email); await typeInto(page, '#password', 'Passw0rd!' + ri(10, 99), true);
    await hclick(page, '#auth-submit'); await think(900, 1800);
    if (await page.locator('.banner.error').count() && chance(0.6)) throw new Abandon('signin_failed');
    await hclick(page, '#tab-signup'); await think(400, 900);
  } else await hclick(page, '#tab-signup');
  const weak = chance(0.45);
  for (let attempt = 0; attempt < 3; attempt++) {
    await typeInto(page, '#name', v.first, true); await typeInto(page, '#email', v.email, true);
    const hint = await page.locator('text=10 characters').count();
    await typeInto(page, '#password', weak && attempt === 0 && !hint ? 'password1' : `Wander#${ri(1000, 9999)}go`, true);
    await hclick(page, '#auth-submit'); await sleep(600);
    if (!(await hashNow(page)).startsWith('#/signin')) return;
    if (attempt >= 1 && chance(0.4)) throw new Abandon('signup_error');
    await think(1500, 3200);
  }
  throw new Abandon('signup_error');
}

async function stageTravelers(page, ctx) {
  const { persona: p, v } = ctx;
  await page.waitForSelector('#travelers-form', { timeout: 8000 });
  await think(1000, 2500);
  const pax = await page.locator('.traveler').count();
  const inline = (await page.locator('text=2 letters followed by 7 digits').count()) > 0;
  const passport = () => `${pick(['XA', 'QB', 'MK', 'ZT'])}${ri(1000000, 9999999)}`;
  const fill = async (bad) => {
    for (let i = 0; i < pax; i++) {
      await typeInto(page, `#t${i}-first`, i === 0 ? v.first : pick(FIRST), true);
      await typeInto(page, `#t${i}-last`, v.last, true);
      await page.fill(`#t${i}-dob`, `${ri(1965, 2002)}-0${ri(1, 9)}-1${ri(0, 9)}`);
      let pp = passport();
      if (bad === 1) pp = pp.toLowerCase(); if (bad === 2) pp = pp.slice(0, 2) + ' ' + pp.slice(2);
      await typeInto(page, `#t${i}-passport`, pp, true);
      await sleep(rnd(200, 600) * SPEED);
    }
  };
  const mistakes = inline ? [0] : p.fighter ? [1, 2, 0] : chance(0.25) ? [1, 0] : [0];
  for (let a = 0; a < mistakes.length; a++) {
    await fill(mistakes[a]);
    await hclick(page, '#continue-payment'); await sleep(700);
    if ((await hashNow(page)).startsWith('#/checkout/payment')) return;
    if (p.fighter && a === 1 && chance(0.5)) throw new Abandon('traveler_validation');
    // error banner: poke around, rage-click the button once or twice
    if (chance(0.5)) { await hclick(page, '#continue-payment'); await sleep(150); await hclick(page, '#continue-payment'); }
    await think(1500, 3500);
  }
  if (!(await hashNow(page)).startsWith('#/checkout/payment')) throw new Abandon('traveler_validation');
  gate(p, 'travelers');
}

async function stagePayment(page, ctx) {
  const { persona: p, v } = ctx;
  await page.waitForSelector('#pay-form', { timeout: 8000 });
  const surprise = await page.evaluate(() => (window.__wanderlyEvents || []).filter(e => e.name === 'payment_viewed').pop()?.props?.surpriseFees);
  await think(2500, 6000);
  if (p.sticker && surprise && chance(0.7)) {
    if (chance(0.7)) { await typeInto(page, '#promo', 'SAVE20'); await hclick(page, '#apply-promo'); await think(800, 1500); }
    if (chance(0.4)) { await typeInto(page, '#promo', 'summer'); await hclick(page, '#apply-promo'); await think(800, 1500); }
    if (chance(0.3)) { await typeInto(page, '#promo', 'WANDER10'); await hclick(page, '#apply-promo'); await think(800, 1500); if (chance(0.5)) throw new Abandon('fees_shock_after_promo'); }
    else throw new Abandon('fees_shock');
  }
  if (!p.sticker && surprise && chance(0.18)) throw new Abandon('fees_shock');
  gate(p, 'pay');
  const declinedCard = p.rager && chance(0.3);
  const card = async () => {
    await typeInto(page, '#card', declinedCard ? '4000000000000002' : '4242424242424242');
    await typeInto(page, '#exp', chance(0.12) ? '1229' : '12/29', true); // sometimes wrong format -> "Invalid card."
    await typeInto(page, '#cvc', '123', true); await typeInto(page, '#cardname', `${v.first} ${v.last}`, true);
  };
  await card(); await think(500, 1500);
  for (let attempt = 0; attempt < 3; attempt++) {
    await hclick(page, '#pay-btn');
    await sleep(900);
    if (await page.locator('#pay-error .banner').count()) { // card format error
      await think(1500, 3000); await typeInto(page, '#exp', '12/29', true); continue;
    }
    // Is there any feedback? If not, impatient users hammer the button.
    const feedback = await page.evaluate(() => { const b = document.querySelector('#pay-btn'); return b && (b.disabled || /processing/i.test(b.textContent)); });
    if (!feedback && (p.rager || chance(0.22))) { const n = p.rager ? ri(4, 8) : ri(2, 3); for (let i = 0; i < n; i++) { await hclick(page, '#pay-btn'); await sleep(rnd(110, 300)); } }
    try { await page.waitForFunction(() => location.hash.startsWith('#/confirmation') || /failed|declined/i.test(document.getElementById('toast')?.textContent || '') && !document.getElementById('toast').hidden, null, { timeout: 12000 }); } catch { /* timed out */ }
    if ((await hashNow(page)).startsWith('#/confirmation')) return;
    if (declinedCard) throw new Abandon('card_declined');
    if (!chance(p.patient ? 1 : 0.65)) throw new Abandon('payment_failed');
    await think(1500, 3000);
  }
  throw new Abandon('payment_failed');
}

async function stageConfirmation(page, ctx) {
  await think(1500, 4000);
  if (chance(0.45)) { await hclick(page, '#plan-ai'); await think(3000, 7000); }
  else if (chance(0.4)) { await hclick(page, '#view-trips'); await think(1000, 2500); }
}

async function aiFlow(page, ctx) {
  // Entry through the AI concierge. Returns true if the user ends up on results.
  const viaHome = chance(0.6);
  const prompt = pick(AI_PROMPTS);
  if (viaHome) { await typeInto(page, '#ai-prompt-input', prompt); await hclick(page, '#ai-prompt-go'); }
  else { await hclick(page, '#chat-launcher'); await think(600, 1400); await typeInto(page, '#chat-input', prompt); await hclick(page, '#chat-send'); }
  let attempts = 0; let lastPrompt = prompt;
  while (attempts < 3) {
    attempts++;
    const t0 = Date.now();
    try { await page.waitForFunction((n) => document.querySelectorAll('#chat-log .msg.bot').length > n, 1, { timeout: 9500 }); } catch { throw new Abandon('ai_timeout'); }
    if (Date.now() - t0 > 4500 && chance(0.25)) throw new Abandon('ai_too_slow');
    await think(500, 1500);
    const last = page.locator('#chat-log .msg.bot').last();
    const isErr = await last.evaluate(e => e.classList.contains('err'));
    if (isErr) { if (chance(0.4)) throw new Abandon('ai_error'); await typeInto(page, '#chat-input', lastPrompt); await hclick(page, '#chat-send'); await page.waitForFunction((n) => document.querySelectorAll('#chat-log .msg.bot').length > n, 2, { timeout: 9500 }).catch(() => {}); continue; }
    const hasCards = await last.locator('.book-this').count();
    const irrelevant = /popular destinations/i.test(await last.innerText());
    if (irrelevant) { if (chance(0.6)) await last.locator('.fb-down').click().catch(() => {}); if (chance(0.5)) throw new Abandon('ai_irrelevant'); lastPrompt = pick(['Lisbon', 'beach trip', 'Tokyo']); await typeInto(page, '#chat-input', lastPrompt); await hclick(page, '#chat-send'); continue; }
    if (hasCards) {
      if (chance(0.5)) await last.locator('.fb-up').click().catch(() => {});
      for (let i = 0; i < 4; i++) { // dead "Book this" ~30% of clicks
        await hclick(page, '#chat-log .msg.bot:last-of-type .book-this'); await sleep(900);
        if ((await hashNow(page)).startsWith('#/results')) return true;
        if (i >= 1) await sleep(rnd(100, 250));
      }
      if (chance(0.5)) throw new Abandon('ai_book_dead');
      await hclick(page, '#chat-close'); return false; // falls back to manual search
    }
  }
  return false;
}

/* ---------- session runner ---------- */
async function runSession(browser, idx) {
  const persona = wpick(PERSONAS); const v = pickVisitor(); const ch = wpick(CHANNELS);
  const mobile = chance(0.4);
  const geo = v.geo;
  const opts = mobile ? { ...devices['Pixel 7'], locale: geo.locale, timezoneId: geo.tz }
    : { viewport: pick([{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 1920, height: 1080 }]), locale: geo.locale, timezoneId: geo.tz,
        userAgent: pick(['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36']) };
  const ctxB = await browser.newContext(opts);
  const identity = { visitor: { id: v.id, email: v.email, firstName: v.first, country: geo.country, device: mobile ? 'mobile' : 'desktop', persona: persona.name, signupCohort: `2026-${String(1 + (v.n % 10)).padStart(2, '0')}` },
    account: { id: v.acct.id, name: v.acct.name, tier: v.acct.tier, industry: v.acct.industry } };
  await ctxB.addInitScript((id) => { window.WANDERLY_IDENTITY = id; Object.defineProperty(navigator, 'webdriver', { get: () => false }); }, identity);
  const page = await ctxB.newPage();
  page.setDefaultTimeout(10000);
  const out = { persona: persona.name, visitor: v.id, device: mobile ? 'mobile' : 'desktop', stage: 'home', outcome: 'abandoned', reason: '' };
  const ctx = { persona, v };
  try {
    await page.goto(SITE_URL + (ch.p ? '?' + ch.p : '') + '#/', { referer: ch.ref || undefined, waitUntil: 'load' });
    await page.waitForSelector('#search-form');
    let onResults = false;
    if (persona.ai) { out.stage = 'ai'; onResults = await aiFlow(page, ctx); }
    if (!onResults) { out.stage = 'search'; if (!(await hashNow(page)).startsWith('#/results')) { if (!persona.ai) gate(persona, 'search'); if (await page.locator('#chat-panel:not([hidden])').count()) await page.locator('#chat-close').click().catch(() => {}); await stageSearch(page, ctx); } }
    out.stage = 'results'; await stageResults(page, ctx);
    out.stage = 'trip'; await stageTrip(page, ctx);
    out.stage = 'auth'; await stageAuth(page, ctx);
    out.stage = 'travelers'; await stageTravelers(page, ctx);
    out.stage = 'payment'; await stagePayment(page, ctx);
    out.stage = 'confirmed'; out.outcome = 'booked'; await stageConfirmation(page, ctx);
  } catch (e) {
    if (e instanceof Abandon) { out.reason = e.stage; await think(800, 2500).catch(() => {}); }
    else { out.outcome = 'error'; out.reason = String(e.message || e).split('\n')[0].slice(0, 120); }
  } finally { await ctxB.close().catch(() => {}); }
  if (VERBOSE) console.log(idx, JSON.stringify(out));
  return out;
}

function hourWeight(h) { // UTC hour -> relative traffic (US-heavy daytime curve)
  const curve = [0.35, 0.3, 0.3, 0.35, 0.4, 0.5, 0.6, 0.7, 0.85, 1, 1.1, 1.15, 1.2, 1.3, 1.35, 1.3, 1.2, 1.1, 1.0, 0.95, 0.85, 0.7, 0.55, 0.42];
  return curve[h];
}

async function main() {
  const n = Math.max(1, Math.round(BASE_SESSIONS * hourWeight(new Date().getUTCHours()) * rnd(0.8, 1.25)));
  console.log(`Wanderly traffic: ${n} sessions -> ${SITE_URL} (concurrency ${CONCURRENCY})`);
  const browser = await chromium.launch({ headless: true });
  const results = []; let next = 0;
  const worker = async () => { while (next < n) { const i = next++; results.push(await runSession(browser, i)); await sleep(rnd(200, 1500) * SPEED); } };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, n) }, worker));
  await browser.close();
  const by = (k) => results.reduce((m, r) => { const key = r[k] + (k === 'reason' && !r.reason ? '' : ''); m[key] = (m[key] || 0) + 1; return m; }, {});
  const booked = results.filter(r => r.outcome === 'booked').length;
  const lines = [`### Synthetic traffic run`, `- Sessions: **${n}** · Booked: **${booked}** (${Math.round(booked / n * 100)}%) · Errors: ${results.filter(r => r.outcome === 'error').length}`,
    `- Personas: ${JSON.stringify(by('persona'))}`, `- Last stage reached: ${JSON.stringify(by('stage'))}`, `- Drop-off reasons: ${JSON.stringify(by('reason'))}`];
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  const errs = results.filter(r => r.outcome === 'error');
  if (errs.length > n * 0.5) { console.error('Too many script errors:', errs.slice(0, 5)); process.exit(1); }
}
main().catch(e => { console.error(e); process.exit(1); });
