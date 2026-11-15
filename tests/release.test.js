import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compute, shippedFiles } from '../tools/stamp.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');

test('release stamp is current (run `npm run stamp` after any change)', () => {
  const { sw, versionJs } = compute();
  assert.equal(read('sw.js'), sw, 'sw.js is stale — installed copies would not update');
  assert.equal(read('js/version.js'), versionJs);
});

test('service worker precaches every file the game needs offline', () => {
  const { assets } = compute();
  for (const a of assets) if (a !== './') assert.ok(existsSync(join(root, a)), a);
  // Everything index.html and the modules reference must be in the list.
  const html = read('index.html');
  const refs = [...html.matchAll(/(?:href|src)="([^"#]+)"/g)].map((m) => m[1]).filter((u) => !u.startsWith('splash/'));
  for (const r of refs) assert.ok(assets.includes(r), `${r} is referenced by index.html but not precached`);
  for (const f of shippedFiles().filter((f) => f.endsWith('.js'))) {
    for (const m of read(f).matchAll(/from '\.\/([\w.-]+)'/g)) assert.ok(assets.includes(`js/${m[1]}`), `${m[1]} imported by ${f}`);
  }
});

test('manifest is installable and its icons exist', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.display, 'standalone');
  assert.ok(m.name && m.start_url && m.background_color && m.theme_color);
  assert.ok(m.icons.some((i) => i.sizes === '512x512'));
  for (const i of m.icons) assert.ok(existsSync(join(root, i.src)), i.src);
  const html = read('index.html');
  for (const needle of ['apple-touch-icon', 'apple-mobile-web-app-capable', 'apple-mobile-web-app-status-bar-style', 'viewport-fit=cover', 'rel="manifest"']) {
    assert.ok(html.includes(needle), needle);
  }
  for (const m2 of html.matchAll(/href="(splash\/[^"]+)"/g)) assert.ok(existsSync(join(root, m2[1])), m2[1]);
});
