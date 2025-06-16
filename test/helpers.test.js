const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateEuerValues, etvstrtofloat } = require('../helpers.js');

test('etvstrtofloat converts strings with currency and separators', () => {
  assert.strictEqual(etvstrtofloat('1.234,56 €'), 1234.56);
  assert.strictEqual(etvstrtofloat('12,34'), 12.34);
  assert.strictEqual(etvstrtofloat(7.89), 7.89);
});

test('calculateEuerValues handles cancellations', () => {
  const item = { storniert: true };
  const res = calculateEuerValues(item, {}, 0.2);
  assert.deepStrictEqual(res, { einnahmen: 0, ausgaben: 0, entnahmen: 0, einnahmen_aus_anlagevermoegen: 0 });
});

test('calculateEuerValues before cutoff with teilwert', () => {
  const item = { date: '2024-05-20', etv: 100, teilwert: 80 };
  const settings = { einnahmezumteilwert: true };
  const res = calculateEuerValues(item, settings, 0.8);
  assert.deepStrictEqual(res, {
    einnahmen: 80,
    ausgaben: 80,
    entnahmen: 80,
    einnahmen_aus_anlagevermoegen: 0
  });
});

test('calculateEuerValues sold after cutoff uses etv for income', () => {
  const item = { date: '2024-11-01', etv: 100, teilwert: 80, verkauft: true };
  const settings = { einnahmezumteilwert: true };
  const res = calculateEuerValues(item, settings, 0.8);
  assert.deepStrictEqual(res, {
    einnahmen: 100,
    ausgaben: 100,
    entnahmen: 0,
    einnahmen_aus_anlagevermoegen: 80
  });
});
