/**
 * International Phone Number Normalizer and Validator
 * Accepts country codes with or without + and returns E.164 format.
 */

function normalizeUkPhone(input) {
  if (!input) return null;
  
  let cleaned = String(input).trim().replace(/^'/, '');

  // Excel may send large phone values as scientific notation (for example 4.47448E+11).
  if (/^[+]?\d+(?:\.\d+)?e[+\-]?\d+$/i.test(cleaned)) {
    const numericValue = Number(cleaned);
    if (!Number.isSafeInteger(numericValue)) return null;
    cleaned = String(numericValue);
  } else {
    // Strip spaces, dashes, parentheses, and decimal separators from regular phone values.
    cleaned = cleaned.replace(/[\s,\-\(\)\.]/g, '');
  }

  // Accept international notation that keeps the national trunk zero: +44 (0) 7...
  if (cleaned.startsWith('+440')) {
    cleaned = '+44' + cleaned.slice(4);
  }

  // Accept country codes without the + (for example 447... and 917...).
  if (!cleaned.startsWith('+') && (cleaned.startsWith('44') || cleaned.startsWith('91'))) {
    cleaned = '+' + cleaned;
  }

  // Check valid UK format (+44 followed by 9 or 10 digits).
  // UK Mobiles: +44 7xxx xxx xxx
  // UK Geographic: +44 1xxx xxx xxx or +44 2xxx xxx xxx
  // UK Non-geographic: +44 3xxx xxx xxx
  const ukRegex = /^\+44[123789]\d{8,9}$/;
  const indiaMobileRegex = /^\+91[6-9]\d{9}$/;
  if (!ukRegex.test(cleaned) && !indiaMobileRegex.test(cleaned)) {
    return null;
  }

  return cleaned;
}

function isUkMobile(normalizedPhone) {
  return /^\+447\d{9}$/.test(normalizedPhone);
}

module.exports = {
  normalizeUkPhone,
  isUkMobile
};
