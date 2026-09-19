const test = require('node:test');
const assert = require('node:assert');
const {
  evaluateQualification,
  QUALIFICATION_STATUS,
  CHECK_STATUS
} = require('../src/voice/qualificationEngine');
const {
  normalizeAndValidateField,
  normalizeCurrencyOrNumber,
  normalizeInteger
} = require('../src/voice/qualificationNormalization');
const {
  createInitialQualificationState,
  FIELD_DEFINITIONS,
  FIELD_CLASSIFICATION
} = require('../src/voice/qualificationConstants');
const { handleUpdateQualification } = require('../src/voice/tools/qualificationTools');
const { executeTool, TOOL_DEFINITIONS } = require('../src/voice/tools/toolRegistry');

test('Phase 2.1 — Structured Qualification Foundation', async (t) => {
  const defaultRules = {
    minDebtAmount: 5000,
    minCreditors: 2,
    acceptedRegions: ['England', 'Wales', 'Northern Ireland']
  };

  // 1. Empty qualification state
  await t.test('1. Empty qualification state evaluates as IN_PROGRESS with UNKNOWN checks', () => {
    const result = evaluateQualification({}, defaultRules);
    assert.strictEqual(result.qualified, false);
    assert.strictEqual(result.eligibleSoFar, false);
    assert.strictEqual(result.status, QUALIFICATION_STATUS.IN_PROGRESS);
    assert.strictEqual(result.checks.debtAmount.status, CHECK_STATUS.UNKNOWN);
    assert.strictEqual(result.checks.debtAmount.value, null);
    assert.strictEqual(result.checks.creditorCount.status, CHECK_STATUS.UNKNOWN);
    assert.strictEqual(result.checks.residency.status, CHECK_STATUS.UNKNOWN);
    assert(result.missingFields.includes('debtAmount'));
    assert(result.missingFields.includes('creditorCount'));
  });

  // 2. Missing debt amount
  await t.test('2. Missing debt amount leaves debt check UNKNOWN and status IN_PROGRESS', () => {
    const state = { creditorCount: 3, ukResident: true };
    const result = evaluateQualification(state, defaultRules);
    assert.strictEqual(result.qualified, false);
    assert.strictEqual(result.status, QUALIFICATION_STATUS.IN_PROGRESS);
    assert.strictEqual(result.checks.debtAmount.status, CHECK_STATUS.UNKNOWN);
    assert(result.missingFields.includes('debtAmount'));
  });

  // 3. Valid debt amount
  await t.test('3. Valid debt amount passes debt check', () => {
    const state = { debtAmount: 12000, creditorCount: 3, ukResident: true };
    const result = evaluateQualification(state, defaultRules);
    assert.strictEqual(result.checks.debtAmount.status, CHECK_STATUS.PASS);
    assert.strictEqual(result.checks.debtAmount.value, 12000);
  });

  // 4. Invalid debt amount
  await t.test('4. Invalid debt amount fails debt check and sets NOT_SUITABLE', () => {
    const state = { debtAmount: 'invalid_debt', creditorCount: 3, ukResident: true };
    const result = evaluateQualification(state, defaultRules);
    assert.strictEqual(result.checks.debtAmount.status, CHECK_STATUS.FAIL);
    assert.strictEqual(result.qualified, false);
    assert.strictEqual(result.status, QUALIFICATION_STATUS.NOT_SUITABLE);
  });

  // 5. Debt below configured business threshold
  await t.test('5. Debt below configured business threshold fails check', () => {
    const customRules = { minDebtAmount: 7000, minCreditors: 2 };
    const state = { debtAmount: 6500, creditorCount: 3, ukResident: true };
    const result = evaluateQualification(state, customRules);
    assert.strictEqual(result.checks.debtAmount.status, CHECK_STATUS.FAIL);
    assert.strictEqual(result.status, QUALIFICATION_STATUS.NOT_SUITABLE);
    assert(result.reasons.some((r) => r.includes('below the minimum threshold of £7,000')));
  });

  // 6. Debt meeting configured business threshold
  await t.test('6. Debt meeting configured business threshold passes check', () => {
    const customRules = { minDebtAmount: 7000, minCreditors: 2 };
    const state = { debtAmount: 7000, creditorCount: 3, ukResident: true };
    const result = evaluateQualification(state, customRules);
    assert.strictEqual(result.checks.debtAmount.status, CHECK_STATUS.PASS);
    assert.strictEqual(result.checks.debtAmount.value, 7000);
  });

  // 7. Missing creditor count
  await t.test('7. Missing creditor count leaves creditor count UNKNOWN and status IN_PROGRESS', () => {
    const state = { debtAmount: 8500, ukResident: true };
    const result = evaluateQualification(state, defaultRules);
    assert.strictEqual(result.checks.creditorCount.status, CHECK_STATUS.UNKNOWN);
    assert.strictEqual(result.qualified, false);
    assert.strictEqual(result.status, QUALIFICATION_STATUS.IN_PROGRESS);
    assert(result.missingFields.includes('creditorCount'));
  });

  // 8. Invalid creditor count
  await t.test('8. Invalid creditor count fails creditor check', () => {
    const state = { debtAmount: 8500, creditorCount: 'none', ukResident: true };
    const result = evaluateQualification(state, defaultRules);
    assert.strictEqual(result.checks.creditorCount.status, CHECK_STATUS.FAIL);
    assert.strictEqual(result.status, QUALIFICATION_STATUS.NOT_SUITABLE);
  });

  // 9. Creditor count below configured threshold
  await t.test('9. Creditor count below configured threshold fails check', () => {
    const customRules = { minDebtAmount: 5000, minCreditors: 3 };
    const state = { debtAmount: 8500, creditorCount: 2, ukResident: true };
    const result = evaluateQualification(state, customRules);
    assert.strictEqual(result.checks.creditorCount.status, CHECK_STATUS.FAIL);
    assert.strictEqual(result.status, QUALIFICATION_STATUS.NOT_SUITABLE);
    assert(result.reasons.some((r) => r.includes('below the required minimum of 3')));
  });

  // 10. Creditor count meeting configured threshold
  await t.test('10. Creditor count meeting configured threshold passes check', () => {
    const customRules = { minDebtAmount: 5000, minCreditors: 3 };
    const state = { debtAmount: 8500, creditorCount: 3, ukResident: true };
    const result = evaluateQualification(state, customRules);
    assert.strictEqual(result.checks.creditorCount.status, CHECK_STATUS.PASS);
    assert.strictEqual(result.checks.creditorCount.value, 3);
  });

  // 11. UK residency
  await t.test('11. Non-UK resident fails residency check and results in NOT_SUITABLE', () => {
    const state = { debtAmount: 9000, creditorCount: 3, ukResident: false };
    const result = evaluateQualification(state, defaultRules);
    assert.strictEqual(result.checks.residency.status, CHECK_STATUS.FAIL);
    assert.strictEqual(result.status, QUALIFICATION_STATUS.NOT_SUITABLE);
    assert(result.reasons.some((r) => r.includes('not a resident in qualifying UK regions')));
  });

  // 12. Unsupported region
  await t.test('12. Unsupported region (e.g. Scotland) fails residency check', () => {
    const state = { debtAmount: 9000, creditorCount: 3, ukResident: true, region: 'Scotland' };
    const result = evaluateQualification(state, defaultRules);
    assert.strictEqual(result.checks.residency.status, CHECK_STATUS.FAIL);
    assert.strictEqual(result.status, QUALIFICATION_STATUS.NOT_SUITABLE);
    assert(result.reasons.some((r) => r.includes('not in accepted IVA jurisdictions')));
  });

  // 13. Structured nested qualification state
  await t.test('13. Evaluates structured nested qualification state seamlessly', () => {
    const structuredState = {
      debt: {
        totalAmount: 14000,
        creditorCount: 4,
        types: ['credit_card', 'loan'],
        priorityDebtPresent: false
      },
      income: {
        employmentStatus: 'employed',
        monthlyIncome: 2400,
        benefits: false
      },
      expenditure: {
        monthlyExpenses: 1800,
        disposableIncome: 600
      },
      housing: {
        status: 'tenant_private',
        mortgageBalance: null,
        arrears: false
      },
      assets: {
        ownsProperty: false,
        ownsVehicle: true,
        otherAssets: null
      },
      existingSolutions: [],
      residency: {
        ukResident: true,
        region: 'England'
      }
    };

    const result = evaluateQualification(structuredState, defaultRules);
    assert.strictEqual(result.qualified, true);
    assert.strictEqual(result.eligibleSoFar, true);
    assert.strictEqual(result.status, QUALIFICATION_STATUS.POTENTIAL_REFERRAL);
    assert.strictEqual(result.checks.debtAmount.status, CHECK_STATUS.PASS);
    assert.strictEqual(result.checks.debtAmount.value, 14000);
    assert.strictEqual(result.checks.creditorCount.status, CHECK_STATUS.PASS);
    assert.strictEqual(result.checks.creditorCount.value, 4);
    assert.strictEqual(result.checks.residency.status, CHECK_STATUS.PASS);
    assert.strictEqual(result.missingFields.length, 0);
  });

  // 14. PASS / FAIL / UNKNOWN checks
  await t.test('14. Correctly distinguishes PASS, FAIL, and UNKNOWN in checks', () => {
    const mixedState = {
      debtAmount: 10000, // PASS
      creditorCount: 1,  // FAIL (min 2)
      // ukResident not provided -> UNKNOWN
    };
    const result = evaluateQualification(mixedState, defaultRules);
    assert.strictEqual(result.checks.debtAmount.status, CHECK_STATUS.PASS);
    assert.strictEqual(result.checks.creditorCount.status, CHECK_STATUS.FAIL);
    assert.strictEqual(result.checks.residency.status, CHECK_STATUS.UNKNOWN);
    assert.strictEqual(result.status, QUALIFICATION_STATUS.NOT_SUITABLE);
  });

  // 15. Missing required fields
  await t.test('15. Field definitions clearly classify REQUIRED, OPTIONAL, and CONDITIONAL fields', () => {
    assert.strictEqual(FIELD_DEFINITIONS['debt.totalAmount'].classification, FIELD_CLASSIFICATION.REQUIRED);
    assert.strictEqual(FIELD_DEFINITIONS['debt.creditorCount'].classification, FIELD_CLASSIFICATION.REQUIRED);
    assert.strictEqual(FIELD_DEFINITIONS['residency.ukResident'].classification, FIELD_CLASSIFICATION.REQUIRED);
    assert.strictEqual(FIELD_DEFINITIONS['income.monthlyIncome'].classification, FIELD_CLASSIFICATION.OPTIONAL);
    assert.strictEqual(FIELD_DEFINITIONS['housing.mortgageBalance'].classification, FIELD_CLASSIFICATION.CONDITIONAL);
  });

  // 16. update_qualification valid field
  await t.test('16. update_qualification tool updates state, runs evaluation, and logs audit', async () => {
    const session = {
      callId: 'test_call_audit_1',
      qualificationState: createInitialQualificationState(),
      qualificationAudit: []
    };

    const res = await handleUpdateQualification({ field: 'debt.totalAmount', value: '£12,500' }, session);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.updatedField, 'debt.totalAmount');
    assert.strictEqual(res.value, 12500);
    assert.strictEqual(session.qualificationState.debt.totalAmount, 12500);
    assert.strictEqual(session.qualificationState.debtAmount, 12500); // getter backward compat

    assert.strictEqual(session.qualificationAudit.length, 1);
    assert.strictEqual(session.qualificationAudit[0].field, 'debt.totalAmount');
    assert.strictEqual(session.qualificationAudit[0].oldValue, null);
    assert.strictEqual(session.qualificationAudit[0].newValue, 12500);
    assert.strictEqual(session.qualificationAudit[0].source, 'AI_CONVERSATION');
  });

  // 17. update_qualification invalid field
  await t.test('17. update_qualification rejects unknown field names', async () => {
    const session = {
      callId: 'test_call_invalid_field',
      qualificationState: createInitialQualificationState()
    };

    const res = await handleUpdateQualification({ field: 'unsupported.randomField', value: 123 }, session);
    assert.strictEqual(res.success, false);
    assert(res.error.includes('Unknown or unsupported qualification field'));
  });

  // 18. update_qualification invalid value
  await t.test('18. update_qualification rejects invalid/negative values', async () => {
    const session = {
      callId: 'test_call_invalid_val',
      qualificationState: createInitialQualificationState()
    };

    const res1 = await handleUpdateQualification({ field: 'debt.totalAmount', value: -200 }, session);
    assert.strictEqual(res1.success, false);
    assert(res1.error.includes('Invalid') || res1.error.includes('cannot be less than'));

    const res2 = await handleUpdateQualification({ field: 'debt.creditorCount', value: 'not-a-number' }, session);
    assert.strictEqual(res2.success, false);
  });

  // 19. Normalization of currency values
  await t.test('19. Normalizes currency strings deterministically', () => {
    assert.strictEqual(normalizeCurrencyOrNumber('£12,500'), 12500);
    assert.strictEqual(normalizeCurrencyOrNumber('12,500 pounds'), 12500);
    assert.strictEqual(normalizeCurrencyOrNumber('12.5k'), 12500);
    assert.strictEqual(normalizeCurrencyOrNumber('12k'), 12000);
    assert.strictEqual(normalizeCurrencyOrNumber(15000), 15000);
    assert.strictEqual(normalizeCurrencyOrNumber('-500'), null);
    assert.strictEqual(normalizeCurrencyOrNumber('abc'), null);

    assert.strictEqual(normalizeInteger('3 creditors'), 3);
    assert.strictEqual(normalizeInteger('4'), 4);
    assert.strictEqual(normalizeInteger(-1), null);
  });

  // 20. Qualification status remains deterministic
  await t.test('20. Qualification status evaluation is completely deterministic', () => {
    const state = { debtAmount: 8500, creditorCount: 3, ukResident: true };
    const res1 = evaluateQualification(state, defaultRules);
    const res2 = evaluateQualification(state, defaultRules);

    assert.strictEqual(res1.qualified, res2.qualified);
    assert.strictEqual(res1.status, res2.status);
    assert.strictEqual(res1.checks.debtAmount.status, res2.checks.debtAmount.status);
    assert.strictEqual(res1.checks.creditorCount.status, res2.checks.creditorCount.status);
    assert.strictEqual(res1.checks.residency.status, res2.checks.residency.status);
    assert.deepStrictEqual(res1.reasons, res2.reasons);
  });

  // 21. LLM cannot directly set qualification status
  await t.test('21. Rejects attempts by the LLM to directly set qualification status', async () => {
    const session = {
      callId: 'test_call_ai_tamper',
      qualificationState: createInitialQualificationState()
    };

    const res1 = await handleUpdateQualification({ field: 'qualified', value: true }, session);
    assert.strictEqual(res1.success, false);
    assert(res1.error.includes('Direct mutation of qualification status'));

    const res2 = await handleUpdateQualification({ field: 'status', value: 'TRANSFER_READY' }, session);
    assert.strictEqual(res2.success, false);
    assert(res2.error.includes('Direct mutation of qualification status'));
  });

  // 22. Tool Registry integration
  await t.test('22. update_qualification is registered in TOOL_DEFINITIONS and executable', async () => {
    const updateTool = TOOL_DEFINITIONS.find((t) => t.name === 'update_qualification');
    assert(updateTool, 'update_qualification must be in TOOL_DEFINITIONS');
    assert(updateTool.parameters.required.includes('field'));
    assert(updateTool.parameters.required.includes('value'));

    const session = {
      callId: 'test_registry_exec',
      qualificationState: createInitialQualificationState()
    };
    const execResult = await executeTool('update_qualification', { field: 'debt.creditorCount', value: '3 creditors' }, session);
    assert.strictEqual(execResult.success, true);
    assert.strictEqual(execResult.value, 3);
  });
});
