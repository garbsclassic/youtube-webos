import { test } from 'node:test';
import assert from 'node:assert/strict';

// getWebOSVersion() caches its result in module scope, so each case needs a
// fresh module instance -- a cache-busting query param forces Node's ESM
// loader to re-evaluate the module instead of returning the memoized one.
let importCounter = 0;
async function freshWebOSUtils(userAgent) {
  globalThis.window = { navigator: { userAgent } };
  return import(`../src/webos-utils.js?t=${++importCounter}`);
}

test('getWebOSVersion detects webOS 3-6 from platform year', async () => {
  assert.equal((await freshWebOSUtils('webOS.TV-2016')).getWebOSVersion(), 3);
  assert.equal((await freshWebOSUtils('webOS.TV-2018')).getWebOSVersion(), 4);
  assert.equal((await freshWebOSUtils('webOS.TV-2020')).getWebOSVersion(), 5);
  assert.equal((await freshWebOSUtils('webOS.TV-2021')).getWebOSVersion(), 6);
});

test('getWebOSVersion detects webOS 22-25 from platform year', async () => {
  assert.equal((await freshWebOSUtils('webOS.TV-2022')).getWebOSVersion(), 22);
  assert.equal((await freshWebOSUtils('webOS.TV-2023')).getWebOSVersion(), 23);
  assert.equal((await freshWebOSUtils('webOS.TV-2024')).getWebOSVersion(), 24);
  assert.equal((await freshWebOSUtils('webOS.TV-2025')).getWebOSVersion(), 25);
});

test('isWebOS25 is true only for webOS 25+', async () => {
  assert.equal((await freshWebOSUtils('webOS.TV-2025')).isWebOS25(), true);
  assert.equal((await freshWebOSUtils('webOS.TV-2024')).isWebOS25(), false);
});

test('getWebOSVersion falls back to firmware version for webOS 25+ when the platform year is unrecognized', async () => {
  const mod = await freshWebOSUtils('Mozilla/5.0 _TV_O18/33.1.2 (LG, TV)');
  assert.equal(mod.getWebOSVersion(), 25);
});

test('getWebOSVersion ignores a below-threshold firmware version', async () => {
  const mod = await freshWebOSUtils('Mozilla/5.0 _TV_O18/32.9.9 (LG, TV)');
  // No platform year, no qualifying firmware match, no Chrome token either --
  // falls all the way through to the hardcoded default.
  assert.equal(mod.getWebOSVersion(), 6);
});

test('getWebOSVersion falls back to Chrome-version sniffing in simulator environments', async () => {
  const high = await freshWebOSUtils('Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36');
  assert.equal(high.getWebOSVersion(), 25);
  assert.equal(high.simulatorMode, true);

  const low = await freshWebOSUtils('Mozilla/5.0 Chrome/50.0.0.0 Safari/537.36');
  assert.equal(low.getWebOSVersion(), 4);

  const mid = await freshWebOSUtils('Mozilla/5.0 Chrome/90.0.0.0 Safari/537.36');
  assert.equal(mid.getWebOSVersion(), 6);
});

test('getWebOSVersion defaults to 6 when nothing in the user agent matches', async () => {
  const mod = await freshWebOSUtils('Mozilla/5.0 (SomeOtherDevice)');
  assert.equal(mod.getWebOSVersion(), 6);
});

test('getWebOSVersion caches its result per module instance', async () => {
  const mod = await freshWebOSUtils('webOS.TV-2022');
  assert.equal(mod.getWebOSVersion(), 22);
  // Mutating the UA after the first call must not change the cached result.
  globalThis.window.navigator.userAgent = 'webOS.TV-2016';
  assert.equal(mod.getWebOSVersion(), 22);
});

test('getWebOSVersion treats an unmapped future platform year as a floor, not a simulator', async () => {
  // 2026 isn't in WEBOS_YEAR_MAP yet, but a real TV reporting it should
  // degrade to "newest known" (year - 2000) rather than falling through to
  // Chrome-version sniffing and being flagged as a simulator.
  const mod = await freshWebOSUtils('webOS.TV-2026');
  assert.equal(mod.getWebOSVersion(), 26);
  assert.equal(mod.simulatorMode, false);
  assert.equal(mod.isWebOS25(), true);
});
