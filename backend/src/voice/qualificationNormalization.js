/**
 * UK IVA Cold Calling & Lead Qualification - Normalization & Validation Layer
 * 
 * Safely normalizes and validates data extracted during voice conversations
 * before updating customer qualification facts.
 * 
 * Rejects invalid inputs deterministically.
 */

const {
  FIELD_DEFINITIONS,
  FIELD_ALIASES
} = require('./qualificationConstants');

/**
 * Resolves a field name/path to its canonical dot-notation path.
 * Supports legacy aliases (e.g., 'debtAmount' -> 'debt.totalAmount').
 * 
 * @param {string} field - Raw field name or path
 * @returns {string|null} Canonical path or null if unrecognized
 */
function resolveFieldPath(field) {
  if (typeof field !== 'string') return null;
  const trimmed = field.trim();
  if (!trimmed) return null;

  if (FIELD_DEFINITIONS[trimmed]) {
    return trimmed;
  }

  if (FIELD_ALIASES[trimmed]) {
    return FIELD_ALIASES[trimmed];
  }

  // Check case-insensitive match for alias or canonical definition
  const lower = trimmed.toLowerCase();
  for (const [key, val] of Object.entries(FIELD_ALIASES)) {
    if (key.toLowerCase() === lower) return val;
  }
  for (const key of Object.keys(FIELD_DEFINITIONS)) {
    if (key.toLowerCase() === lower) return key;
  }

  return null;
}

/**
 * Normalizes a currency or decimal number string/number to a clean float.
 * Handles '£', commas, 'k' (e.g. '12.5k' -> 12500), 'pounds'.
 * Rejects negative values or invalid formats.
 */
function normalizeCurrencyOrNumber(raw) {
  if (typeof raw === 'number') {
    if (isNaN(raw) || !isFinite(raw)) return null;
    return raw;
  }

  if (typeof raw !== 'string') return null;
  let str = raw.trim().toLowerCase();
  if (!str) return null;

  // Check for negative signs
  if (str.includes('-')) return null;

  // Strip £, pounds, gbp, spaces
  str = str.replace(/£|pounds|pound|gbp|\s/g, '');

  // Handle 'k' / 'kilo' suffix (e.g., 12.5k -> 12500, 12k -> 12000)
  if (str.endsWith('k')) {
    const numPart = str.slice(0, -1).replace(/,/g, '');
    const parsed = parseFloat(numPart);
    if (isNaN(parsed) || parsed < 0) return null;
    return Math.round(parsed * 1000 * 100) / 100;
  }

  // Remove commas
  str = str.replace(/,/g, '');

  const parsed = parseFloat(str);
  if (isNaN(parsed) || !isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

/**
 * Normalizes an integer count (e.g. "3 creditors", "5", 5).
 * Rejects negative values or non-integers.
 */
function normalizeInteger(raw) {
  if (typeof raw === 'number') {
    if (isNaN(raw) || !Number.isInteger(raw) || raw < 0) return null;
    return raw;
  }

  if (typeof raw !== 'string') return null;
  const str = raw.trim().toLowerCase();
  if (!str) return null;

  if (str.includes('-')) return null;

  // Match leading integer digits or digits followed by text (e.g. "3 creditors", "5 cards")
  const match = str.match(/^(\d+)(?:\s+[a-z_]+)?$/);
  if (match) {
    const parsed = parseInt(match[1], 10);
    return isNaN(parsed) || parsed < 0 ? null : parsed;
  }

  return null;
}

/**
 * Normalizes a boolean value (e.g. true, false, "yes", "no").
 */
function normalizeBoolean(raw) {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    const str = raw.trim().toLowerCase();
    if (['true', 'yes', 'y', 'correct', 'right', 'yep', 'yeah'].includes(str)) return true;
    if (['false', 'no', 'n', 'incorrect', 'wrong', 'nope'].includes(str)) return false;
  }
  return null;
}

/**
 * Normalizes region strings to UK standard names.
 */
function normalizeRegion(raw) {
  if (typeof raw !== 'string') return null;
  const str = raw.trim().toLowerCase();
  if (str.includes('england')) return 'England';
  if (str.includes('wales')) return 'Wales';
  if (str.includes('scotland')) return 'Scotland';
  if (str.includes('northern ireland') || str === 'ni' || str.includes('n. ireland')) return 'Northern Ireland';
  return raw.trim(); // Return as-is if unrecognized string, validation check will evaluate against acceptedRegions
}

/**
 * Normalizes employment enum.
 */
function normalizeEmploymentStatus(raw) {
  if (typeof raw !== 'string') return null;
  const str = raw.trim().toLowerCase();
  if (str.includes('self')) return 'self_employed';
  if (str.includes('employ') || str.includes('full time') || str.includes('part time')) return 'employed';
  if (str.includes('unemploy')) return 'unemployed';
  if (str.includes('retire') || str.includes('pension')) return 'retired';
  if (str.includes('benefit') || str.includes('universal credit') || str.includes('pip') || str.includes('esa')) return 'benefits';
  if (str.includes('student')) return 'student';
  if (str === 'other') return 'other';
  return null;
}

/**
 * Normalizes housing enum.
 */
function normalizeHousingStatus(raw) {
  if (typeof raw !== 'string') return null;
  const str = raw.trim().toLowerCase();
  if (str.includes('owner') || str.includes('mortgage') || str.includes('own')) return 'homeowner';
  if (str.includes('council') || str.includes('social') || str.includes('housing association')) return 'tenant_council';
  if (str.includes('rent') || str.includes('private') || str.includes('tenant')) return 'tenant_private';
  if (str.includes('family') || str.includes('parent')) return 'living_with_family';
  if (str === 'other') return 'other';
  return null;
}

/**
 * Main normalization & validation dispatcher.
 * Validates the field against FIELD_DEFINITIONS and normalizes the raw value.
 * 
 * @param {string} rawField - The field name or path supplied
 * @param {any} rawValue - The un-sanitized input value from AI or API
 * @returns {{ valid: boolean, canonicalPath?: string, value?: any, error?: string }}
 */
function normalizeAndValidateField(rawField, rawValue) {
  const canonicalPath = resolveFieldPath(rawField);
  if (!canonicalPath) {
    return {
      valid: false,
      error: `Unknown or unsupported qualification field: '${rawField}'`
    };
  }

  const def = FIELD_DEFINITIONS[canonicalPath];
  if (!def) {
    return {
      valid: false,
      error: `Field definition missing for canonical path: '${canonicalPath}'`
    };
  }

  if (rawValue === null || rawValue === undefined) {
    return {
      valid: true,
      canonicalPath,
      value: null
    };
  }

  let normalized = null;

  switch (def.type) {
    case 'number': {
      normalized = normalizeCurrencyOrNumber(rawValue);
      if (normalized === null) {
        return {
          valid: false,
          error: `Invalid number/currency value for field '${canonicalPath}': received ${JSON.stringify(rawValue)}`
        };
      }
      if (def.min !== undefined && normalized < def.min) {
        return {
          valid: false,
          error: `Value for '${canonicalPath}' cannot be less than ${def.min}: received ${normalized}`
        };
      }
      break;
    }

    case 'integer': {
      normalized = normalizeInteger(rawValue);
      if (normalized === null) {
        return {
          valid: false,
          error: `Invalid integer value for field '${canonicalPath}': received ${JSON.stringify(rawValue)}`
        };
      }
      if (def.min !== undefined && normalized < def.min) {
        return {
          valid: false,
          error: `Value for '${canonicalPath}' cannot be less than ${def.min}: received ${normalized}`
        };
      }
      break;
    }

    case 'boolean': {
      normalized = normalizeBoolean(rawValue);
      if (normalized === null) {
        return {
          valid: false,
          error: `Invalid boolean value for field '${canonicalPath}': received ${JSON.stringify(rawValue)}`
        };
      }
      break;
    }

    case 'string': {
      if (canonicalPath === 'residency.region') {
        normalized = normalizeRegion(rawValue);
      } else {
        if (typeof rawValue !== 'string') {
          return {
            valid: false,
            error: `Expected string for field '${canonicalPath}': received ${JSON.stringify(rawValue)}`
          };
        }
        normalized = rawValue.trim();
      }
      break;
    }

    case 'enum': {
      if (canonicalPath === 'income.employmentStatus') {
        normalized = normalizeEmploymentStatus(rawValue);
      } else if (canonicalPath === 'housing.status') {
        normalized = normalizeHousingStatus(rawValue);
      } else if (typeof rawValue === 'string') {
        const clean = rawValue.trim().toLowerCase();
        if (def.allowedValues.includes(clean)) {
          normalized = clean;
        }
      }

      if (!normalized || !def.allowedValues.includes(normalized)) {
        return {
          valid: false,
          error: `Invalid enum value for '${canonicalPath}': received ${JSON.stringify(rawValue)}. Allowed: ${def.allowedValues.join(', ')}`
        };
      }
      break;
    }

    case 'array': {
      let items = [];
      if (Array.isArray(rawValue)) {
        items = rawValue;
      } else if (typeof rawValue === 'string') {
        items = rawValue.split(',').map(s => s.trim().toLowerCase());
      } else {
        return {
          valid: false,
          error: `Expected array or comma-separated list for '${canonicalPath}': received ${JSON.stringify(rawValue)}`
        };
      }

      const validItems = [];
      for (const item of items) {
        const cleanItem = typeof item === 'string' ? item.trim().toLowerCase() : String(item);
        if (def.allowedItems && !def.allowedItems.includes(cleanItem)) {
          return {
            valid: false,
            error: `Invalid item '${cleanItem}' in array for '${canonicalPath}'. Allowed: ${def.allowedItems.join(', ')}`
          };
        }
        validItems.push(cleanItem);
      }
      normalized = validItems;
      break;
    }

    default:
      normalized = rawValue;
  }

  return {
    valid: true,
    canonicalPath,
    value: normalized
  };
}

module.exports = {
  resolveFieldPath,
  normalizeCurrencyOrNumber,
  normalizeInteger,
  normalizeBoolean,
  normalizeRegion,
  normalizeEmploymentStatus,
  normalizeHousingStatus,
  normalizeAndValidateField
};
