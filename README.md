# Wanderly – synthetic AI travel app (for testing Novus)

Wanderly is a **fake** AI-native travel booking web app. Nothing real happens – no real bookings, payments, or users.
It exists so you can install Novus/Pendo on a realistic customer-style app and watch it find problems.

- **The app** (`index.html`, `js/`, `css/`) – static SPA on GitHub Pages: search → results → trip → sign-up wall → traveler details → payment → confirmation, plus a floating **AI concierge** chat.
- **The traffic** (`traffic/generate.mjs`) – Playwright drives a real browser through the live site as ~450 synthetic visitors in ~40 accounts, on a GitHub Actions schedule (every 30 min, scaled by time of day). Real clicks, real page loads – so the Novus agent captures everything.

## Install Novus
Either paste the snippet into `index.html` (marked `NOVUS / PENDO INSTALL POINT`) or set `pendoApiKey` in `config.js`.
Synthetic visitors expose identity as `window.WANDERLY_IDENTITY` (visitor id/email/country/device/persona, account id/name/tier/industry). `js/analytics.js` calls `pendo.initialize()` with it. If your snippet already calls `initialize`, copy that identity in.
Custom track events fired: `search_submitted`, `results_viewed`, `trip_viewed`, `signup_completed`, `checkout_started`, `validation_error`, `payment_submitted`, `payment_failed`, `booking_completed`, `assistant_*`, and more (see `js/*.js`).

## Built-in problems (what Novus should find)
| Area | Problem | Signal |
|---|---|---|
| Search | Vague errors ("Invalid dates.", "No results.") | form errors, abandon at search |
| Results | Changing sort wipes filters; "Price breakdown" looks like a link but is dead | frustration, dead clicks |
| Trip (mobile) | Sticky bar covers the "Select & continue" button | dead/rage clicks, mobile drop-off |
| Trip | Price excludes taxes + a $29/pax concierge fee that only appears at payment | big drop at payment (sticker shock) |
| Auth | Forced sign-up before checkout; password rules revealed only after failing | drop-off, form errors |
| Travelers | Passport format undocumented, case-sensitive, errors only on submit | validation errors, abandon |
| Payment | Pay button gives no feedback for 3–6s; 12% random failure; promo `SUMMER` throws a JS error | rage clicks, JS errors |
| AI concierge | 2–6s replies, ~14% errors, irrelevant fallbacks, "Book this" silently fails ~30% | agent issues, dead clicks, 👎 |

Successes happen too (~5–8% of sessions book), so there is a real funnel.

## Ship the fixes
All fixes are flags in `config.js` (`fixes: { ... }`), all `false` by default. When Novus recommends something, flip the flag, push, and watch the funnel/frustration metrics move. The traffic bots adapt (e.g. they stop rage-clicking Pay once there's a spinner).

## Run traffic manually
```bash
cd traffic && npm ci && npx playwright install chromium
SITE_URL=https://<you>.github.io/wanderly/ SESSIONS=20 npm run run
```
Or Actions → *Synthetic traffic* → *Run workflow*. (GitHub disables scheduled workflows after 60 days of no repo activity – push a commit or re-enable.)
