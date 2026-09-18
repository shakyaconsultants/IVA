const test = require('node:test');
const assert = require('node:assert');
const { evaluateQualification } = require('../src/voice/qualificationEngine');

test('Deterministic Qualification Engine', async (t) => {
  const defaultRules = {
    minDebtAmount: 5000,
    minCreditors: 2,
    acceptedRegions: ['England', 'Wales', 'Northern Ireland']
  };

  await t.test('detects missing fields when state is empty', () => {
    const result = evaluateQualification({}, defaultRules);
    assert.strictEqual(result.qualified, false);
    assert.strictEqual(result.eligibleSoFar, false);
    assert(result.missingFields.includes('debtAmount'));
    assert(result.missingFields.includes('creditorCount'));
  });

  await t.test('marks unqualified if debt is below threshold', () => {
    const state = {
      debtAmount: 3500,
      creditorCount: 3,
      ukResident: true
    };
    const result = evaluateQualification(state, defaultRules);
    assert.strictEqual(result.qualified, false);
    assert.strictEqual(result.eligibleSoFar, false);
    assert(result.reasons.some((r) => r.includes('below the minimum threshold')));
  });

  await t.test('marks unqualified if creditor count is below minimum', () => {
    const state = {
      debtAmount: 8500,
      creditorCount: 1,
      ukResident: true
    };
    const result = evaluateQualification(state, defaultRules);
    assert.strictEqual(result.qualified, false);
    assert.strictEqual(result.eligibleSoFar, false);
    assert(result.reasons.some((r) => r.includes('below the required minimum of 2')));
  });

  await t.test('marks unqualified if UK residency is false', () => {
    const state = {
      debtAmount: 12000,
      creditorCount: 4,
      ukResident: false
    };
    const result = evaluateQualification(state, defaultRules);
    assert.strictEqual(result.qualified, false);
    assert.strictEqual(result.eligibleSoFar, false);
    assert(result.reasons.some((r) => r.includes('not a resident')));
  });

  await t.test('qualifies prospect meeting all criteria', () => {
    const state = {
      debtAmount: 7500,
      creditorCount: 3,
      ukResident: true
    };
    const result = evaluateQualification(state, defaultRules);
    assert.strictEqual(result.qualified, true);
    assert.strictEqual(result.eligibleSoFar, true);
    assert.strictEqual(result.missingFields.length, 0);
  });

  await t.test('supports custom qualification rules from AgentPrompt', () => {
    const customRules = {
      minDebtAmount: 10000,
      minCreditors: 3,
      acceptedRegions: ['england', 'wales']
    };
    const state = {
      debtAmount: 8000, // Meets default 5000, but fails custom 10000
      creditorCount: 3,
      ukResident: true
    };
    const result = evaluateQualification(state, customRules);
    assert.strictEqual(result.qualified, false);
  });
});
