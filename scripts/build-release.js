#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

// Explicit runtime allowlist. Development tooling, tests, ops files, Git
// metadata, node_modules and mutable production state must never enter a
// release artifact.
const REQUIRED_RELEASE_FILES = Object.freeze([
  'index.html',
  'styles.css',
  'app.js',
  'admin.html',
  'admin_server.js',
  'fetch_pv_news.js',
  'fetch_prices.js',
  'fetch_wechat.js',
  'bd_push.py',
  'merge.js',
  'source_registry.js',
  'lib/safe_io.js',
  'lib/process_lock.js',
  'lib/source_health.js',
  'lib/custom_sources.js',
  'lib/safe_remote_fetch.js',
  'lib/x_sources.js',
  'package.json',
  'package-lock.json',
  'data.json',
  'data_fallback.js',
  'site_texts.json',
  'site_texts_fallback.js',
  'pvhot-skill/SKILL.md',
  'pvhot-skill/README.md',
  'pvhot-skill/install.sh',
  'robots.txt',
  'sitemap.xml',
  'og-image-v4.jpg',
  'qrcode_wechat.jpg',
  'baidu_verify_codeva-vHjUI6fnHC.html',
  'c953027fa91a245e4a273f09c69bd57b.txt',
]);

const OPTIONAL_RELEASE_FILES = Object.freeze([
  'data_bootstrap.json',
]);

function fail(message) {
  throw new Error(message);
}

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: options.encoding || 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: options.stdio,
  });
}

function gitObjectExists(sha, file) {
  try {
    git(['cat-file', '-e', `${sha}:${file}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function gitFileMode(sha, file) {
  const line = git(['ls-tree', sha, '--', file]).trim();
  const match = line.match(/^(\d{6})\s+blob\s+[0-9a-f]+\t/);
  if (!match) fail(`cannot resolve regular Git blob ${file} at ${sha}`);
  return match[1];
}

function parseArguments(argv) {
  if (argv.length !== 2) {
    fail('usage: node scripts/build-release.js <40-character-git-sha> <output-directory>');
  }
  const [requestedSha, outputDirectory] = argv;
  if (!/^[0-9a-f]{40}$/.test(requestedSha)) {
    fail('release SHA must be a full lowercase 40-character Git commit');
  }
  return {
    requestedSha,
    outputDirectory: path.resolve(outputDirectory),
  };
}

function validateCommit(requestedSha) {
  const resolved = git(['rev-parse', '--verify', `${requestedSha}^{commit}`]).trim();
  if (resolved !== requestedSha) {
    fail(`requested SHA did not resolve to the exact commit: ${requestedSha}`);
  }
}

function releaseFilesAtCommit(sha) {
  const missing = REQUIRED_RELEASE_FILES.filter((file) => !gitObjectExists(sha, file));
  if (missing.length) {
    fail(`release commit is missing required files: ${missing.join(', ')}`);
  }

  const files = [
    ...REQUIRED_RELEASE_FILES,
    ...OPTIONAL_RELEASE_FILES.filter((file) => gitObjectExists(sha, file)),
  ];
  for (const file of files) {
    const mode = gitFileMode(sha, file);
    if (mode === '120000') fail(`release allowlist may not contain a symbolic link: ${file}`);
  }
  return files.sort();
}

function listArchiveFiles(artifactPath) {
  const output = execFileSync('tar', ['-tzf', artifactPath], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return output
    .split(/\r?\n/)
    .map((entry) => entry.replace(/^\.\//, '').trim())
    .filter((entry) => entry && !entry.endsWith('/'))
    .sort();
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function main() {
  const { requestedSha, outputDirectory } = parseArguments(process.argv.slice(2));
  validateCommit(requestedSha);
  const releaseFiles = releaseFilesAtCommit(requestedSha);

  fs.mkdirSync(outputDirectory, { recursive: true });
  const artifactName = `pvhot-${requestedSha}.tar.gz`;
  const artifactPath = path.join(outputDirectory, artifactName);
  const checksumPath = `${artifactPath}.sha256`;
  if (fs.existsSync(artifactPath) || fs.existsSync(checksumPath)) {
    fail(`refusing to overwrite an existing release artifact in ${outputDirectory}`);
  }

  git([
    'archive',
    '--format=tar.gz',
    `--output=${artifactPath}`,
    requestedSha,
    '--',
    ...releaseFiles,
  ], { stdio: 'inherit' });

  const archivedFiles = listArchiveFiles(artifactPath);
  if (!arraysEqual(archivedFiles, releaseFiles)) {
    const unexpected = archivedFiles.filter((file) => !releaseFiles.includes(file));
    const absent = releaseFiles.filter((file) => !archivedFiles.includes(file));
    fail(
      `release archive allowlist mismatch; missing=[${absent.join(', ')}] `
      + `unexpected=[${unexpected.join(', ')}]`
    );
  }

  const digest = sha256File(artifactPath);
  fs.writeFileSync(checksumPath, `${digest}  ${artifactName}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });

  console.log(JSON.stringify({
    artifact: artifactPath,
    checksum: checksumPath,
    files: releaseFiles.length,
    gitSha: requestedSha,
    sha256: digest,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Release build failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  OPTIONAL_RELEASE_FILES,
  REQUIRED_RELEASE_FILES,
};
