// Fake travel inventory, generated deterministically from the search so results are stable.
export const DESTINATIONS = [
  { code: 'LIS', city: 'Lisbon', country: 'Portugal', emoji: '🇵🇹', tags: ['europe', 'food', 'beach', 'cheap', 'couples'], base: 420, hue: 28 },
  { code: 'BCN', city: 'Barcelona', country: 'Spain', emoji: '🇪🇸', tags: ['europe', 'beach', 'food', 'nightlife'], base: 460, hue: 12 },
  { code: 'ROM', city: 'Rome', country: 'Italy', emoji: '🇮🇹', tags: ['europe', 'history', 'food', 'couples'], base: 510, hue: 8 },
  { code: 'PAR', city: 'Paris', country: 'France', emoji: '🇫🇷', tags: ['europe', 'couples', 'history', 'luxury'], base: 540, hue: 262 },
  { code: 'TYO', city: 'Tokyo', country: 'Japan', emoji: '🇯🇵', tags: ['asia', 'food', 'culture', 'family'], base: 980, hue: 340 },
  { code: 'BKK', city: 'Bangkok', country: 'Thailand', emoji: '🇹🇭', tags: ['asia', 'cheap', 'food', 'beach'], base: 860, hue: 140 },
  { code: 'BAL', city: 'Bali', country: 'Indonesia', emoji: '🇮🇩', tags: ['asia', 'beach', 'couples', 'honeymoon', 'cheap'], base: 920, hue: 170 },
  { code: 'CUN', city: 'Cancún', country: 'Mexico', emoji: '🇲🇽', tags: ['beach', 'family', 'cheap', 'nightlife'], base: 480, hue: 190 },
  { code: 'NYC', city: 'New York', country: 'USA', emoji: '🇺🇸', tags: ['city', 'culture', 'family', 'weekend'], base: 260, hue: 220 },
  { code: 'MIA', city: 'Miami', country: 'USA', emoji: '🇺🇸', tags: ['beach', 'weekend', 'nightlife'], base: 240, hue: 320 },
  { code: 'REK', city: 'Reykjavík', country: 'Iceland', emoji: '🇮🇸', tags: ['europe', 'nature', 'adventure', 'couples'], base: 580, hue: 200 },
  { code: 'CPT', city: 'Cape Town', country: 'South Africa', emoji: '🇿🇦', tags: ['africa', 'nature', 'adventure', 'wine'], base: 1040, hue: 100 },
  { code: 'DXB', city: 'Dubai', country: 'UAE', emoji: '🇦🇪', tags: ['luxury', 'family', 'city', 'beach'], base: 790, hue: 45 },
  { code: 'SYD', city: 'Sydney', country: 'Australia', emoji: '🇦🇺', tags: ['beach', 'city', 'nature'], base: 1380, hue: 205 },
  { code: 'MLE', city: 'Malé', country: 'Maldives', emoji: '🇲🇻', tags: ['beach', 'honeymoon', 'luxury', 'couples'], base: 1250, hue: 180 },
  { code: 'DEN', city: 'Denver', country: 'USA', emoji: '🇺🇸', tags: ['nature', 'adventure', 'weekend', 'family'], base: 190, hue: 120 }
];

export const ORIGINS = ['Boston (BOS)', 'New York (JFK)', 'Chicago (ORD)', 'San Francisco (SFO)', 'Austin (AUS)', 'Seattle (SEA)', 'Atlanta (ATL)', 'Los Angeles (LAX)'];

const AIRLINES = ['SkyBridge', 'Northwind Air', 'Aerolux', 'BlueHorizon', 'Meridian Airways', 'Cobalt Jet'];
const HOTELS = ['Casa Aurora', 'The Wanderer', 'Harbor & Pine', 'Villa Serena', 'Hotel Meridian', 'The Lantern House', 'Palm & Stone', 'Atlas Suites'];

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let s = seed || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

export const fmt = (n) => '$' + Math.round(n).toLocaleString('en-US');
export const findDest = (q) => {
  if (!q) return null;
  const s = String(q).toLowerCase();
  return DESTINATIONS.find(d => s.includes(d.city.toLowerCase()) || s.includes(d.code.toLowerCase())) || null;
};
export const nightsBetween = (a, b) => Math.max(1, Math.round((new Date(b) - new Date(a)) / 86400000));

export function searchPackages({ from, to, depart, ret, pax }) {
  const dest = findDest(to);
  if (!dest) return [];
  const nights = nightsBetween(depart, ret);
  const r = rng(hash([from, dest.code, depart, ret].join('|')));
  const out = [];
  for (let i = 0; i < 8; i++) {
    const stops = r() < 0.4 ? 0 : r() < 0.7 ? 1 : 2;
    const stars = 2 + Math.floor(r() * 4);
    const airline = AIRLINES[Math.floor(r() * AIRLINES.length)];
    const hotel = HOTELS[Math.floor(r() * HOTELS.length)];
    const flightPp = dest.base * (0.55 + r() * 0.5) * (stops === 0 ? 1.18 : stops === 1 ? 1 : 0.86);
    const hotelPn = 55 + stars * 28 + r() * 40;
    const perPerson = flightPp + (hotelPn * nights) / Math.max(1, Math.ceil(pax / 2)) / Math.max(1, pax) * Math.max(1, pax);
    const id = `${dest.code}-${hash([from, depart, ret, i].join('|')).toString(36).slice(0, 5)}`;
    out.push({
      id, dest: dest.code, city: dest.city, country: dest.country, emoji: dest.emoji, hue: dest.hue,
      from, depart, ret, pax, nights, stops, stars, airline, hotel,
      durationH: Math.round((4 + r() * 9 + stops * 2.5) * 10) / 10,
      rating: Math.round((7.2 + r() * 2.5) * 10) / 10,
      reviews: 120 + Math.floor(r() * 2400),
      perPerson: Math.round(perPerson),
      base: Math.round(perPerson * pax),
      refundable: r() < 0.45
    });
  }
  return out;
}

export function priceBreakdown(pkg) {
  const subtotal = pkg.base;
  const taxes = Math.round(subtotal * 0.14);
  const concierge = 29 * pkg.pax;
  return { subtotal, taxes, concierge, total: subtotal + taxes + concierge };
}

export function futureDate(days) {
  const d = new Date(Date.now() + days * 86400000);
  return d.toISOString().slice(0, 10);
}
