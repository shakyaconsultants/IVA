const test = require('node:test');
const assert = require('node:assert');
const { normalizeUkPhone } = require('../src/services/ukPhoneValidator');

test('normalizes uploaded UK phone numbers to +44 format', () => {
  const inputs = [
    '+447700900123',
    '+44 7700 900123',
    '+44 (0) 7700 900123',
    "'+44 7700 900123",
    '447700900123'
  ];

  for (const input of inputs) {
    assert.strictEqual(normalizeUkPhone(input), '+447700900123');
  }
});

test('accepts Indian and UK country codes without plus', () => {
  assert.strictEqual(normalizeUkPhone('917309565645'), '+917309565645');
  assert.strictEqual(normalizeUkPhone('447309565645'), '+447309565645');
  assert.strictEqual(normalizeUkPhone('4.47448E+11'), '+447448000000');
  assert.strictEqual(normalizeUkPhone('4.47497E+11'), '+447497000000');
});

test('rejects invalid phone numbers', () => {
  assert.strictEqual(normalizeUkPhone('07700 900123'), null);
  assert.strictEqual(normalizeUkPhone('517309565645'), null);
  assert.strictEqual(normalizeUkPhone('not-a-phone'), null);
});