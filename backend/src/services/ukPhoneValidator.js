/**
 * UK Phone Number Normalizer and Validator
 * Formats numbers into E.164 (+44...) and validates UK telecom ranges.
 */

function normalizeUkPhone(input) {
  if (!input) return null;
  
  // Strip spaces, dashes, parentheses
  let cleaned = String(input).trim().replace(/[\s\-\(\)\.]/g, '');

  // If starts with 0044, replace with +44
  if (cleaned.startsWith('0044')) {
    cleaned = '+44' + cleaned.slice(4);
  }

  // If starts with 44 without +, add +
  if (cleaned.startsWith('44') && cleaned.length >= 12) {
    cleaned = '+' + cleaned;
  }

  // If starts with UK national trunk prefix 0 (e.g. 07... or 01... or 02...)
  if (cleaned.startsWith('0')) {
    cleaned = '+44' + cleaned.slice(1);
  }

  // Check valid UK format (+44 followed by 9 or 10 digits)
  // UK Mobiles: +44 7xxx xxx xxx
  // UK Geographic: +44 1xxx xxx xxx or +44 2xxx xxx xxx
  // UK Non-geographic: +44 3xxx xxx xxx
  const ukRegex = /^\+44[123789]\d{8,9}$/;
  if (!ukRegex.test(cleaned)) {
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
