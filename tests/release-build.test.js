'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { REQUIRED_RELEASE_FILES } = require('../scripts/build-release');

const ROOT = path.resolve(__dirname, '..');

test('production release includes the X runtime module', () => {
  assert.ok(REQUIRED_RELEASE_FILES.includes('lib/x_sources.js'));
});

test('every static local runtime require is present in the release allowlist', () => {
  const releaseFiles = new Set(REQUIRED_RELEASE_FILES);
  const missing = [];
  for (const file of REQUIRED_RELEASE_FILES.filter((entry) => entry.endsWith('.js'))) {
    const absolute = path.join(ROOT, file);
    const source = fs.readFileSync(absolute, 'utf8');
    const requirePattern = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
    let match;
    while ((match = requirePattern.exec(source)) !== null) {
      let dependency = path.resolve(path.dirname(absolute), match[1]);
      if (!path.extname(dependency)) dependency += '.js';
      const relative = path.relative(ROOT, dependency).replaceAll('\\', '/');
      if (!releaseFiles.has(relative)) missing.push(`${file} -> ${relative}`);
    }
  }

  assert.deepEqual(missing, []);
});
