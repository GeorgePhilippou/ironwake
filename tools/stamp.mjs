#!/usr/bin/env node
// Stamps a release: hashes every shipped file and writes the result into
// sw.js (VERSION + the precache list) and js/version.js.
// Run `npm run stamp` before committing — `npm test` fails if you forget.
//   node tools/stamp.mjs          write
//   node tools/stamp.mjs --check  exit 1 if out of date

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const GENERATED = new Set(['js/version.js']);

export function shippedFiles() {
  const list = (dir, ok) => readdirSync(join(root, dir)).filter(ok).sort().map((f) => `${dir}/${f}`);
  return [
    'index.html',
    'manifest.webmanifest',
    ...list('css', (f) => f.endsWith('.css')),
    ...list('js', (f) => f.endsWith('.js')),
    ...list('icons', (f) => /\.(png|svg)$/.test(f) && f !== 'icon.svg'),
  ];
}

export function compute() {
  const files = shippedFiles();
  const hash = createHash('sha256');
  for (const f of files) {
    if (GENERATED.has(f)) continue;
    hash.update(f).update('\0').update(readFileSync(join(root, f))).update('\0');
  }
  const version = `${SEMVER}-${hash.digest('hex').slice(0, 8)}`;
  const versionJs = `// Written by tools/stamp.mjs — do not edit.\nexport const VERSION = '${version}';\n`;
  const assets = ['./', ...files];
  const sw = readFileSync(join(root, 'sw.js'), 'utf8')
    .replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`)
    .replace(/const ASSETS = \[[^\]]*\];/, `const ASSETS = [\n${assets.map((a) => `  '${a}',`).join('\n')}\n];`);
  return { version, versionJs, sw, assets };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { version, versionJs, sw } = compute();
  const stale = readFileSync(join(root, 'sw.js'), 'utf8') !== sw
    || readFileSync(join(root, 'js/version.js'), 'utf8') !== versionJs;
  if (process.argv.includes('--check')) {
    if (stale) { console.error('Release stamp is out of date — run: npm run stamp'); process.exit(1); }
    console.log(`stamp ok (${version})`);
  } else {
    writeFileSync(join(root, 'sw.js'), sw);
    writeFileSync(join(root, 'js/version.js'), versionJs);
    console.log(`${stale ? 'stamped' : 'unchanged'} ${version}`);
  }
}
