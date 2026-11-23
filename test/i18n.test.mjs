import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = ['it', 'en', 'de', 'es', 'fr'];

test('manifest.json is valid MV3 and cross-browser compatible', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.deepEqual(manifest.background.scripts, ['background.js']);
  assert.equal(manifest.background.type, 'module');
  assert.ok(manifest.browser_specific_settings?.gecko?.id);
  assert.ok(manifest.permissions.includes('sidePanel'), 'sidePanel permission expected for Chrome Side Panel');
  assert.equal(manifest.side_panel?.default_path, 'popup.html?view=panel');
  assert.ok(manifest.host_permissions.includes('https://perplexity.ai/*'), 'Bare perplexity.ai host permission expected');
  assert.ok(
    manifest.content_scripts[0].matches.includes('https://perplexity.ai/*'),
    'Bare perplexity.ai content_script match expected'
  );
  assert.ok(!manifest.permissions.includes('clipboardRead'), 'Unused clipboardRead should not be requested');
  assert.ok(!manifest.host_permissions.includes('*://*/*'), 'Overbroad *://*/* host permission should not be requested');

  // Verify every icon file referenced by manifest exists on disk
  for (const iconPath of Object.values(manifest.icons)) {
    assert.ok(fs.existsSync(path.join(ROOT, iconPath)), `Missing icon: ${iconPath}`);
  }
});

test('all 5 locale files have identical key sets and cover every referenced i18n key', () => {
  const localeMaps = {};
  for (const loc of LOCALES) {
    const file = path.join(ROOT, '_locales', loc, 'messages.json');
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    localeMaps[loc] = new Set(Object.keys(json));
    for (const [key, entry] of Object.entries(json)) {
      assert.ok(typeof entry.message === 'string' && entry.message.trim().length > 0, `Empty message ${loc}:${key}`);
    }
  }

  const baseKeys = [...localeMaps.it].sort();
  for (const loc of LOCALES) {
    assert.deepEqual([...localeMaps[loc]].sort(), baseKeys, `Locale ${loc} key mismatch vs it`);
  }

  const filesToScan = [
    'manifest.json',
    'background.js',
    'content_source.js',
    'content_target.js',
    'popup.html',
    'popup.js',
    'options.html',
    'options.js',
  ];

  const referenced = new Set(['promptShortInstruction', 'promptDetailedInstruction', 'promptKeyPointsInstruction']);
  for (const rel of filesToScan) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const m of text.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) referenced.add(m[1]);
    for (const m of text.matchAll(/data-i18n(?:-[a-z]+)?="([^"]+)"/g)) referenced.add(m[1]);
    for (const m of text.matchAll(/(?:getMessage|\bt)\(['"]([A-Za-z0-9_]+)['"]/g)) referenced.add(m[1]);
  }

  const missing = [...referenced].filter((k) => !localeMaps.it.has(k));
  assert.deepEqual(missing, [], `Referenced i18n keys missing from locales: ${missing.join(', ')}`);
});
