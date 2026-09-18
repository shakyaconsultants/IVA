/**
 * Deterministic qualification engine for UK IVA lead qualification.
 * 
 * Rules are evaluated against business criteria (from AgentPrompt or defaults)
 * without delegating financial eligibility authority to the LLM.
 */

function evaluateQualification(state = {}, rules = {}) {
  const minDebtAmount = typeof rules.minDebtAmount === 'number' ? rules.minDebtAmount : 5000;
  const minCreditors = typeof rules.minCreditors === 'number' ? rules.minCreditors : 2;
  const acceptedRegions = Array.isArray(rules.acceptedRegions) && rules.acceptedRegions.length > 0
    ? rules.acceptedRegions.map((r) => String(r).toLowerCase())
    : ['england', 'wales', 'northern ireland'];

  const reasons = [];
  const missingFields = [];
  let eligible = true;

  // 1. Debt Amount Check
  if (state.debtAmount === undefined || state.debtAmount === null) {
    missingFields.push('debtAmount');
    eligible = false;
  } else {
    const debt = Number(state.debtAmount);
    if (isNaN(debt) || debt < minDebtAmount) {
      eligible = false;
      reasons.push(`Debt amount (£${debt || 0}) is below the minimum threshold of £${minDebtAmount.toLocaleString('en-GB')}.`);
    } else {
      reasons.push(`Debt amount (£${debt.toLocaleString('en-GB')}) meets the qualification threshold (≥ £${minDebtAmount.toLocaleString('en-GB')}).`);
    }
  }

  // 2. Creditor Count Check
  if (state.creditorCount === undefined || state.creditorCount === null) {
    missingFields.push('creditorCount');
  } else {
    const creditors = Number(state.creditorCount);
    if (isNaN(creditors) || creditors < minCreditors) {
      eligible = false;
      reasons.push(`Creditor count (${creditors || 0}) is below the required minimum of ${minCreditors} separate creditors.`);
    } else {
      reasons.push(`Creditor count (${creditors}) satisfies requirements (≥ ${minCreditors}).`);
    }
  }

  // 3. UK Residency Check (if provided)
  if (state.ukResident !== undefined && state.ukResident !== null) {
    if (state.ukResident === false) {
      eligible = false;
      reasons.push('Prospect is not a resident in qualifying UK regions (England, Wales, Northern Ireland).');
    } else {
      reasons.push('Prospect confirmed UK residency in qualifying regions.');
    }
  }

  // Region specific check if region provided
  if (state.region) {
    const regionLower = String(state.region).toLowerCase().trim();
    if (!acceptedRegions.some((r) => regionLower.includes(r))) {
      eligible = false;
      reasons.push(`Region (${state.region}) is not in accepted IVA jurisdictions.`);
    }
  }

  const qualified = eligible && missingFields.length === 0;

  return {
    qualified,
    eligibleSoFar: eligible,
    reasons,
    missingFields,
    evaluatedAt: new Date()
  };
}

module.exports = {
  evaluateQualification
};
