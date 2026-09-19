/**
 * Deterministic qualification engine for UK IVA lead qualification.
 * 
 * Rules are evaluated against business criteria (from AgentPrompt or defaults)
 * without delegating financial eligibility authority to the LLM.
 * 
 * Separates Customer Facts from Configurable Business Rules.
 */

const {
  QUALIFICATION_STATUS,
  CHECK_STATUS,
  getNestedValue
} = require('./qualificationConstants');

/**
 * Evaluates customer qualification facts against business rules.
 * Supports both structured qualification state and legacy flat properties.
 * 
 * @param {Object} state - Customer qualification facts (structured or flat)
 * @param {Object} rules - Configurable business rules
 * @returns {Object} Deterministic evaluation result with status, checks, reasons, missingFields
 */
function evaluateQualification(state = {}, rules = {}) {
  // Configurable Business Rules (never hardcoded to customer facts)
  const minDebtAmount = typeof rules.minDebtAmount === 'number' ? rules.minDebtAmount : 5000;
  const minCreditors = typeof rules.minCreditors === 'number' ? rules.minCreditors : 2;
  const acceptedRegions = Array.isArray(rules.acceptedRegions) && rules.acceptedRegions.length > 0
    ? rules.acceptedRegions.map((r) => String(r).toLowerCase().trim())
    : ['england', 'wales', 'northern ireland'];

  const reasons = [];
  const missingFields = [];
  let eligible = true;

  const checks = {
    debtAmount: {
      status: CHECK_STATUS.UNKNOWN,
      value: null
    },
    creditorCount: {
      status: CHECK_STATUS.UNKNOWN,
      value: null
    },
    residency: {
      status: CHECK_STATUS.UNKNOWN,
      value: null
    }
  };

  // Extract facts supporting both structured and legacy flat format
  const rawDebtAmount = getNestedValue(state, 'debt.totalAmount') ?? state.debtAmount;
  const rawCreditorCount = getNestedValue(state, 'debt.creditorCount') ?? state.creditorCount;
  const rawUkResident = getNestedValue(state, 'residency.ukResident') ?? state.ukResident;
  const rawRegion = getNestedValue(state, 'residency.region') ?? state.region;

  // 1. Debt Amount Check
  if (rawDebtAmount === undefined || rawDebtAmount === null) {
    missingFields.push('debtAmount');
    eligible = false;
    checks.debtAmount = {
      status: CHECK_STATUS.UNKNOWN,
      value: null
    };
  } else {
    const debt = Number(rawDebtAmount);
    if (isNaN(debt) || debt < minDebtAmount) {
      eligible = false;
      checks.debtAmount = {
        status: CHECK_STATUS.FAIL,
        value: isNaN(debt) ? null : debt
      };
      reasons.push(`Debt amount (£${debt || 0}) is below the minimum threshold of £${minDebtAmount.toLocaleString('en-GB')}.`);
    } else {
      checks.debtAmount = {
        status: CHECK_STATUS.PASS,
        value: debt
      };
      reasons.push(`Debt amount (£${debt.toLocaleString('en-GB')}) meets the qualification threshold (≥ £${minDebtAmount.toLocaleString('en-GB')}).`);
    }
  }

  // 2. Creditor Count Check
  if (rawCreditorCount === undefined || rawCreditorCount === null) {
    missingFields.push('creditorCount');
    checks.creditorCount = {
      status: CHECK_STATUS.UNKNOWN,
      value: null
    };
  } else {
    const creditors = Number(rawCreditorCount);
    if (isNaN(creditors) || creditors < minCreditors) {
      eligible = false;
      checks.creditorCount = {
        status: CHECK_STATUS.FAIL,
        value: isNaN(creditors) ? null : creditors
      };
      reasons.push(`Creditor count (${creditors || 0}) is below the required minimum of ${minCreditors} separate creditors.`);
    } else {
      checks.creditorCount = {
        status: CHECK_STATUS.PASS,
        value: creditors
      };
      reasons.push(`Creditor count (${creditors}) satisfies requirements (≥ ${minCreditors}).`);
    }
  }

  // 3. UK Residency Check
  if (rawUkResident !== undefined && rawUkResident !== null) {
    if (rawUkResident === false) {
      eligible = false;
      checks.residency = {
        status: CHECK_STATUS.FAIL,
        value: false
      };
      reasons.push('Prospect is not a resident in qualifying UK regions (England, Wales, Northern Ireland).');
    } else {
      // Confirmed UK resident
      checks.residency = {
        status: CHECK_STATUS.PASS,
        value: true
      };
      reasons.push('Prospect confirmed UK residency in qualifying regions.');
    }
  }

  // Region specific check if region provided
  if (rawRegion) {
    const regionLower = String(rawRegion).toLowerCase().trim();
    if (!acceptedRegions.some((r) => regionLower.includes(r))) {
      eligible = false;
      checks.residency = {
        status: CHECK_STATUS.FAIL,
        value: rawRegion
      };
      reasons.push(`Region (${rawRegion}) is not in accepted IVA jurisdictions.`);
    } else if (checks.residency.status !== CHECK_STATUS.FAIL) {
      checks.residency = {
        status: CHECK_STATUS.PASS,
        value: rawRegion
      };
    }
  }

  const qualified = eligible && missingFields.length === 0;

  // Determine status model - distinguish missing information from failed criteria
  let status = QUALIFICATION_STATUS.IN_PROGRESS;

  const hasFailedCheck = checks.debtAmount.status === CHECK_STATUS.FAIL ||
                         checks.creditorCount.status === CHECK_STATUS.FAIL ||
                         checks.residency.status === CHECK_STATUS.FAIL;

  const hasUnknownCheck = checks.debtAmount.status === CHECK_STATUS.UNKNOWN ||
                          checks.creditorCount.status === CHECK_STATUS.UNKNOWN;

  if (state.declined || state.customerDeclined || state.disposition === 'Not Interested' || state.disposition === 'DNC') {
    status = QUALIFICATION_STATUS.CUSTOMER_DECLINED;
  } else if (state.callbackRequired || state.disposition === 'Callback Requested') {
    status = QUALIFICATION_STATUS.CALLBACK_REQUIRED;
  } else if (hasFailedCheck) {
    status = QUALIFICATION_STATUS.NOT_SUITABLE;
  } else if (hasUnknownCheck || missingFields.length > 0) {
    status = QUALIFICATION_STATUS.IN_PROGRESS;
  } else if (qualified) {
    if (state.transferReady || state.transferRequested) {
      status = QUALIFICATION_STATUS.TRANSFER_READY;
    } else if (state.needsReview) {
      status = QUALIFICATION_STATUS.NEEDS_REVIEW;
    } else if (state.informationComplete) {
      status = QUALIFICATION_STATUS.INFORMATION_COMPLETE;
    } else {
      status = QUALIFICATION_STATUS.POTENTIAL_REFERRAL;
    }
  } else {
    status = QUALIFICATION_STATUS.IN_PROGRESS;
  }

  return {
    status,
    qualified,
    eligibleSoFar: eligible,
    checks,
    reasons,
    missingFields,
    evaluatedAt: new Date()
  };
}

module.exports = {
  evaluateQualification,
  QUALIFICATION_STATUS,
  CHECK_STATUS
};
