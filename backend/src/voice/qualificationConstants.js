/**
 * UK IVA Cold Calling & Lead Qualification - Data Contract & Constants
 * 
 * Defines structured qualification facts, field classifications (REQUIRED, OPTIONAL, CONDITIONAL),
 * qualification outcome statuses, and check statuses.
 */

const QUALIFICATION_STATUS = Object.freeze({
  IN_PROGRESS: 'IN_PROGRESS',
  INFORMATION_COMPLETE: 'INFORMATION_COMPLETE',
  POTENTIAL_REFERRAL: 'POTENTIAL_REFERRAL',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  NOT_SUITABLE: 'NOT_SUITABLE',
  CUSTOMER_DECLINED: 'CUSTOMER_DECLINED',
  CALLBACK_REQUIRED: 'CALLBACK_REQUIRED',
  TRANSFER_READY: 'TRANSFER_READY'
});

const CHECK_STATUS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  UNKNOWN: 'UNKNOWN'
});

const FIELD_CLASSIFICATION = Object.freeze({
  REQUIRED: 'REQUIRED',
  OPTIONAL: 'OPTIONAL',
  CONDITIONAL: 'CONDITIONAL'
});

/**
 * Central Field Definitions
 */
const FIELD_DEFINITIONS = Object.freeze({
  'debt.totalAmount': {
    classification: 'REQUIRED',
    type: 'number',
    min: 0,
    description: 'Total unsecured debt across all cards, loans, overdrafts in GBP (£)'
  },
  'debt.creditorCount': {
    classification: 'REQUIRED',
    type: 'integer',
    min: 0,
    description: 'Total number of separate creditors/lenders'
  },
  'debt.types': {
    classification: 'OPTIONAL',
    type: 'array',
    allowedItems: [
      'credit_card',
      'loan',
      'overdraft',
      'catalog',
      'payday',
      'tax_hmrc',
      'store_card',
      'utility_arrears',
      'other'
    ],
    description: 'Types of unsecured debts reported by customer'
  },
  'debt.priorityDebtPresent': {
    classification: 'OPTIONAL',
    type: 'boolean',
    description: 'Whether priority arrears (rent, council tax, energy, HMRC) are present'
  },
  'income.employmentStatus': {
    classification: 'OPTIONAL',
    type: 'enum',
    allowedValues: [
      'employed',
      'self_employed',
      'unemployed',
      'retired',
      'benefits',
      'student',
      'other'
    ],
    description: 'Current employment status'
  },
  'income.monthlyIncome': {
    classification: 'OPTIONAL',
    type: 'number',
    min: 0,
    description: 'Net monthly household income in GBP (£)'
  },
  'income.benefits': {
    classification: 'OPTIONAL',
    type: 'boolean',
    description: 'Whether prospect receives state benefits'
  },
  'expenditure.monthlyExpenses': {
    classification: 'OPTIONAL',
    type: 'number',
    min: 0,
    description: 'Total monthly living expenses in GBP (£)'
  },
  'expenditure.disposableIncome': {
    classification: 'OPTIONAL',
    type: 'number',
    description: 'Estimated or calculated monthly disposable income in GBP (£)'
  },
  'housing.status': {
    classification: 'OPTIONAL',
    type: 'enum',
    allowedValues: [
      'homeowner',
      'tenant_private',
      'tenant_council',
      'living_with_family',
      'other'
    ],
    description: 'Housing / tenure status'
  },
  'housing.mortgageBalance': {
    classification: 'CONDITIONAL',
    dependsOn: 'housing.status',
    condition: (state) => getNestedValue(state, 'housing.status') === 'homeowner',
    type: 'number',
    min: 0,
    description: 'Remaining mortgage balance in GBP (£) for homeowners'
  },
  'housing.arrears': {
    classification: 'CONDITIONAL',
    dependsOn: 'housing.status',
    condition: (state) => {
      const h = getNestedValue(state, 'housing.status');
      return h === 'homeowner' || (typeof h === 'string' && h.includes('tenant'));
    },
    type: 'boolean',
    description: 'Whether mortgage or rent payments are in arrears'
  },
  'assets.ownsProperty': {
    classification: 'OPTIONAL',
    type: 'boolean',
    description: 'Whether prospect owns residential or commercial property'
  },
  'assets.ownsVehicle': {
    classification: 'OPTIONAL',
    type: 'boolean',
    description: 'Whether prospect owns a motor vehicle'
  },
  'assets.otherAssets': {
    classification: 'OPTIONAL',
    type: 'string',
    description: 'Other significant assets or savings'
  },
  'existingSolutions': {
    classification: 'OPTIONAL',
    type: 'array',
    allowedItems: [
      'dmp',
      'iva',
      'bankruptcy',
      'dro',
      'breathing_space',
      'none'
    ],
    description: 'Current or past debt management solutions'
  },
  'residency.ukResident': {
    classification: 'REQUIRED',
    type: 'boolean',
    description: 'Whether prospect is a UK resident'
  },
  'residency.region': {
    classification: 'OPTIONAL',
    type: 'string',
    description: 'UK nation or region of residence (England, Wales, Northern Ireland, Scotland)'
  }
});

/**
 * Backward-compatible mapping of legacy flat field names to canonical dot-notation paths
 */
const FIELD_ALIASES = Object.freeze({
  debtAmount: 'debt.totalAmount',
  creditorCount: 'debt.creditorCount',
  ukResident: 'residency.ukResident',
  region: 'residency.region',
  employmentStatus: 'income.employmentStatus',
  monthlyIncome: 'income.monthlyIncome',
  monthlyExpenses: 'expenditure.monthlyExpenses',
  disposableIncome: 'expenditure.disposableIncome',
  housingStatus: 'housing.status',
  ownsProperty: 'assets.ownsProperty',
  ownsVehicle: 'assets.ownsVehicle'
});

/**
 * Helper to retrieve value at dot-path
 */
function getNestedValue(obj, path) {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let curr = obj;
  for (const part of parts) {
    if (curr === null || curr === undefined) return undefined;
    curr = curr[part];
  }
  return curr;
}

/**
 * Helper to set value at dot-path
 */
function setNestedValue(obj, path, value) {
  if (!obj || !path) return;
  const parts = path.split('.');
  let curr = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!curr[part] || typeof curr[part] !== 'object') {
      curr[part] = {};
    }
    curr = curr[part];
  }
  curr[parts[parts.length - 1]] = value;
}

/**
 * Factory for initial structured qualification state
 */
function createInitialQualificationState() {
  const state = {
    debt: {
      totalAmount: null,
      creditorCount: null,
      types: [],
      priorityDebtPresent: null
    },
    income: {
      employmentStatus: null,
      monthlyIncome: null,
      benefits: null
    },
    expenditure: {
      monthlyExpenses: null,
      disposableIncome: null
    },
    housing: {
      status: null,
      mortgageBalance: null,
      arrears: null
    },
    assets: {
      ownsProperty: null,
      ownsVehicle: null,
      otherAssets: null
    },
    existingSolutions: [],
    residency: {
      ukResident: null,
      region: null
    },

    // Lifecycle / status indicators
    interested: false,
    qualified: false,
    missingFields: ['debtAmount', 'creditorCount', 'ukResident']
  };

  // Provide backward-compatible flat getters & setters
  Object.defineProperties(state, {
    debtAmount: {
      get() { return this.debt.totalAmount; },
      set(val) { this.debt.totalAmount = val; },
      enumerable: true,
      configurable: true
    },
    creditorCount: {
      get() { return this.debt.creditorCount; },
      set(val) { this.debt.creditorCount = val; },
      enumerable: true,
      configurable: true
    },
    ukResident: {
      get() { return this.residency.ukResident; },
      set(val) { this.residency.ukResident = val; },
      enumerable: true,
      configurable: true
    },
    region: {
      get() { return this.residency.region; },
      set(val) { this.residency.region = val; },
      enumerable: true,
      configurable: true
    }
  });

  return state;
}

module.exports = {
  QUALIFICATION_STATUS,
  CHECK_STATUS,
  FIELD_CLASSIFICATION,
  FIELD_DEFINITIONS,
  FIELD_ALIASES,
  getNestedValue,
  setNestedValue,
  createInitialQualificationState
};
