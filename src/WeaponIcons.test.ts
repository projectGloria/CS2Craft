import { afterEach, expect, it, vi } from 'vitest';
import { readWeaponIconPreferences, weaponIconStorageKey } from './WeaponIcons';

afterEach(() => vi.unstubAllGlobals());
it('restores saved weapon icons and ignores malformed preference values', () => {
  const getItem = vi.fn(() => '{"AK-47":"skin-a","USP-S":"skin-b","AWP":17,"M4A4":""}');
  vi.stubGlobal('localStorage', { getItem });
  expect(readWeaponIconPreferences()).toEqual({ 'AK-47': 'skin-a', 'USP-S': 'skin-b' });
  expect(getItem).toHaveBeenCalledWith(weaponIconStorageKey);
  getItem.mockReturnValue('{broken');
  expect(readWeaponIconPreferences()).toEqual({});
  getItem.mockReturnValue('["skin-a"]');
  expect(readWeaponIconPreferences()).toEqual({});
});
