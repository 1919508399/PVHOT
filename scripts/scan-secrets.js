#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { TextDecoder } = require('node:util');

const ROOT = path.resolve(__dirname, '..');
const HISTORY_MODE = process.argv.includes('--history');
const MAX_FILE_BYTES = 4 * 1024 * 1024;

const DETECTORS = [
  {
    id: 'private-key',
    pattern: /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/,
  },
  {
    id: 'github-token',
    pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  },
  {
    id: 'aws-access-key',
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    id: 'credential-in-url',
    pattern: /:\/\/[^/\s:@]+:([^/\s@]{8,})@/,
    valueGroup: 1,
  },
  {
    id: 'url-query-credential',
    pattern: /[?&](?:access_token|api[_-]?key|token|secret|key)=([^&#\s'"]{8,})/i,
    valueGroup: 1,
  },
  {
    id: 'literal-assignment',
    pattern: /(?:password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*(['"])([^'"]{8,})\1/i,
    valueGroup: 2,
  },
];

const PLACEHOLDER_PATTERN = /^(?:<[^>]+>|\$\{[^}]+\}|\*+|x+|your[_ -]|replace[_ -]|change[_ -]|example|sample|dummy|placeholder|test[_ -]|todo)/i;
const SAFE_CONTEXT_PATTERN = /(?:process\.env|Deno\.env|os\.environ|os\.getenv|secrets\.|\$\{\{\s*secrets\.|getPassHash|DETECTORS|pattern:)/i;

function isScannable(file) {
  const normalized = file.replaceAll('\\', '/');
  if (
    normalized.startsWith('.git/')
    || normalized.startsWith('node_modules/')
    || /\.(?:gif|ico|jpe?g|png|webp|zip|gz|pdf)$/i.test(normalized)
  ) {
    return false;
  }
  return true;
}

function detectLine(line) {
  if (SAFE_CONTEXT_PATTERN.test(line)) return null;
  for (const detector of DETECTORS) {
    const match = line.match(detector.pattern);
    if (!match) continue;
    const value = detector.valueGroup ? match[detector.valueGroup] : '';
    if (value && PLACEHOLDER_PATTERN.test(value.trim())) continue;
    return detector.id;
  }
  return null;
}

function scanText(text, location, findings) {
  text.split(/\r?\n/).forEach((line, index) => {
    const detector = detectLine(line);
    if (detector) findings.push({ location: `${location}:${index + 1}`, detector });
  });
}

function currentFiles() {
  const tracked = execFileSync('git', ['ls-files', '-z'], {
    cwd: ROOT,
    encoding: 'buffer',
    maxBuffer: 16 * 1024 * 1024,
  }).toString('utf8').split('\0').filter(Boolean);
  const untracked = execFileSync('git', ['ls-files', '-z', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'buffer',
    maxBuffer: 16 * 1024 * 1024,
  }).toString('utf8').split('\0').filter(Boolean);
  return [...new Set([...tracked, ...untracked])].filter(isScannable);
}

function scanCurrent(findings) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (const file of currentFiles()) {
    const absolutePath = path.join(ROOT, file);
    if (!fs.existsSync(absolutePath)) continue;
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
    try {
      scanText(decoder.decode(fs.readFileSync(absolutePath)), file.replaceAll('\\', '/'), findings);
    } catch {
      // Invalid UTF-8 is handled by npm run check and is not printed here.
    }
  }
}

function scanHistory(findings) {
  const commits = execFileSync('git', ['rev-list', '--all'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim().split(/\r?\n/).filter(Boolean);
  const seenBlobs = new Set();

  for (const commit of commits) {
    const entries = execFileSync('git', ['ls-tree', '-r', '-z', commit], {
      cwd: ROOT,
      encoding: 'buffer',
      maxBuffer: 32 * 1024 * 1024,
    }).toString('utf8').split('\0').filter(Boolean);

    for (const entry of entries) {
      const match = entry.match(/^\d+\s+blob\s+([0-9a-f]+)\t(.+)$/);
      if (!match) continue;
      const [, blob, file] = match;
      if (seenBlobs.has(blob) || !isScannable(file)) continue;
      seenBlobs.add(blob);

      const buffer = execFileSync('git', ['cat-file', 'blob', blob], {
        cwd: ROOT,
        encoding: 'buffer',
        maxBuffer: MAX_FILE_BYTES + 1,
      });
      if (buffer.length > MAX_FILE_BYTES || buffer.includes(0)) continue;
      const text = buffer.toString('utf8');
      scanText(text, `${commit.slice(0, 12)}:${file}`, findings);
    }
  }
}

function main() {
  const findings = [];
  if (HISTORY_MODE) scanHistory(findings);
  else scanCurrent(findings);

  const unique = [...new Map(findings.map((finding) => [
    `${finding.location}:${finding.detector}`,
    finding,
  ])).values()];

  if (unique.length) {
    console.error(`Potential secrets found (${unique.length}). Values are intentionally redacted:`);
    unique.slice(0, 100).forEach(({ location, detector }) => {
      console.error(`- ${location} [${detector}]`);
    });
    if (unique.length > 100) console.error(`- ... ${unique.length - 100} additional findings omitted`);
    console.error('Rotate confirmed credentials before removing them from code or history.');
    process.exit(1);
  }

  console.log(`Secret scan passed (${HISTORY_MODE ? 'all reachable Git history' : 'current repository files'}).`);
}

if (require.main === module) {
  main();
}

module.exports = {
  detectLine,
  isScannable,
};
