import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKeyValues, parseMaterial, paintCoverage } from './offline-viewer.mjs';
test('merges repeated Valve sections and preserves quoted URL strings', () => {
  const result = parseKeyValues('"items_game" { "items" { "9" { "prefab" "awp" } } // comment\n "items" { "7" { "prefab" "ak47" } } "url" "https://example.test/a" }');
  assert.equal(result.items_game.items['9'].prefab, 'awp');
  assert.equal(result.items_game.items['7'].prefab, 'ak47');
  assert.equal(result.items_game.url, 'https://example.test/a');
});
test('reads compiled material scalar, vector, and resource parameters', () => {
  const result = parseMaterial('{ m_name = "F_PAINT_STYLE" m_nValue = 6 }, { m_name = "g_flWearAmount" m_flValue = 0.0 }, { m_name = "g_vColor0" m_value = [ 1.0, 0.5, 0.0, 0.0 ] }, { m_name = "g_tPattern" m_pValue = resource:"materials/finish.vtex" }');
  assert.equal(result.F_PAINT_STYLE, 6);
  assert.deepEqual(result.g_vColor0, [1, .5, 0, 0]);
  assert.equal(result.g_tPattern, 'materials/finish.vtex');
});
test('protects no-paint regions and custom artwork at the clean endpoint', () => {
  assert.equal(paintCoverage(1, 255, 6), 0);
  assert.equal(paintCoverage(0, 255, 6), 1);
  assert.equal(paintCoverage(1, 0, 6), 1);
  assert.ok(paintCoverage(0, 192, 6) < .02);
});
