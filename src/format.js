'use strict';

const TZ = 'Asia/Kolkata';

/** "12 October 2026" */
function formatDate(d) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

/** "11:30 AM" */
function formatTime(d) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()}`;
}

/** paise (integer) -> "₹1,25,000.00" using Indian digit grouping. */
function formatINR(paise) {
  const rupees = Math.trunc(paise / 100);
  const rem = String(paise % 100).padStart(2, '0');
  const s = String(rupees);
  let grouped;
  if (s.length <= 3) {
    grouped = s;
  } else {
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    grouped = `${rest},${last3}`;
  }
  return `₹${grouped}.${rem}`;
}

/** Parse a user-entered rupee amount into integer paise. Returns null if invalid. */
function parseRupeesToPaise(input) {
  if (typeof input === 'number') input = String(input);
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return parseInt(whole, 10) * 100 + parseInt(frac.padEnd(2, '0') || '0', 10);
}

module.exports = { formatDate, formatTime, formatINR, parseRupeesToPaise, TZ };
