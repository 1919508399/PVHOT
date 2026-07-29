#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { TextDecoder } = require('node:util');

const ROOT = path.resolve(__dirname, '..');
const failures = [];
const checks = [];

function gitFiles(args) {
  const output = execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'buffer',
    maxBuffer: 16 * 1024 * 1024,
  });
  return output
    .toString('utf8')
    .split('\0')
    .map((file) => file.trim())
    .filter(Boolean);
}

function repositoryFiles() {
  const files = new Set([
    ...gitFiles(['ls-files', '-z']),
    ...gitFiles(['ls-files', '-z', '--others', '--exclude-standard']),
  ]);
  return [...files]
    .map((file) => file.replaceAll('\\', '/'))
    .filter((file) => !file.startsWith('deploy/_legacy_broken/'))
    .sort();
}

function fail(scope, message) {
  failures.push(`${scope}: ${message}`);
}

function pass(message) {
  checks.push(message);
}

function validateRequiredFiles(files) {
  const required = [
    '.editorconfig',
    '.gitattributes',
    '.nvmrc',
    'README.md',
    'package-lock.json',
    'package.json',
    'scripts/build-release.js',
    'scripts/check-repo.js',
    'scripts/dev-server.js',
    'scripts/remote-deploy.sh',
    'scripts/scan-secrets.js',
    'scripts/smoke.js',
    'scripts/run-tests.js',
  ];
  for (const file of required) {
    if (!files.includes(file)) fail('structure', `missing ${file}`);
  }
  pass('required development files');
}

function validateUtf8(files) {
  const extensions = new Set([
    '.bat',
    '.conf',
    '.css',
    '.html',
    '.js',
    '.json',
    '.md',
    '.py',
    '.sh',
    '.txt',
    '.xml',
    '.yaml',
    '.yml',
  ]);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let count = 0;

  for (const file of files) {
    if (!extensions.has(path.extname(file).toLowerCase())) continue;
    const absolutePath = path.join(ROOT, file);
    if (!fs.existsSync(absolutePath) || fs.statSync(absolutePath).size > 8 * 1024 * 1024) continue;
    count += 1;
    try {
      const text = decoder.decode(fs.readFileSync(absolutePath));
      const replacementLine = text.split(/\r?\n/).findIndex((line) => line.includes('\uFFFD'));
      if (replacementLine >= 0) {
        fail('utf8', `${file}:${replacementLine + 1} contains Unicode replacement characters`);
      }
    } catch {
      fail('utf8', `${file} is not valid UTF-8`);
    }
  }
  pass(`${count} UTF-8 text files`);
}

function validateJavaScript(files) {
  const scripts = files.filter((file) =>
    file.endsWith('.js')
    && !file.startsWith('deploy/')
    && fs.existsSync(path.join(ROOT, file))
  );

  for (const file of scripts) {
    const result = spawnSync(process.execPath, ['--check', file], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      const firstLine = (result.stderr || result.stdout || 'syntax error').split(/\r?\n/).find(Boolean);
      fail('javascript', `${file} — ${firstLine}`);
    }
  }
  pass(`${scripts.length} JavaScript files`);
}

function validatePython(files) {
  const scripts = files.filter((file) =>
    file.endsWith('.py')
    && !file.startsWith('deploy/')
    && fs.existsSync(path.join(ROOT, file))
  );
  if (!scripts.length) {
    pass('0 Python files');
    return;
  }

  const configured = process.env.PYTHON;
  const candidates = configured
    ? [configured]
    : (process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']);
  const python = candidates.find((candidate) => {
    const result = spawnSync(candidate, ['--version'], { cwd: ROOT, encoding: 'utf8' });
    return result.status === 0;
  });
  if (!python) {
    fail('python', 'Python is required to validate repository Python files');
    return;
  }

  const syntaxCheck = [
    'import ast, pathlib, sys',
    "ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'), filename=sys.argv[1])",
  ].join('; ');
  for (const file of scripts) {
    const result = spawnSync(python, ['-c', syntaxCheck, file], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      const firstLine = (result.stderr || result.stdout || 'syntax error').split(/\r?\n/).find(Boolean);
      fail('python', `${file} — ${firstLine}`);
    }
  }
  pass(`${scripts.length} Python files`);
}

function validateJson(files) {
  const jsonFiles = files.filter((file) => file.endsWith('.json') && fs.existsSync(path.join(ROOT, file)));
  for (const file of jsonFiles) {
    try {
      JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    } catch (error) {
      fail('json', `${file} — ${error.message}`);
    }
  }

  const dataPath = path.join(ROOT, 'data.json');
  if (fs.existsSync(dataPath)) {
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    if (!Array.isArray(data.items)) fail('data.json', 'items must be an array');
    if (!Array.isArray(data.categories)) fail('data.json', 'categories must be an array');
  }
  pass(`${jsonFiles.length} JSON files`);
}

function validateHtml() {
  const requirements = {
    'index.html': [
      /<!doctype html>/i,
      /<meta[^>]+charset=["']?utf-8/i,
      /<meta[^>]+name=["']viewport["']/i,
      /<link[^>]+href=["']styles\.css(?:\?[^"']*)?["']/i,
      /<script[^>]+src=["']app\.js(?:\?[^"']*)?["']/i,
    ],
    'admin.html': [
      /<!doctype html>/i,
      /<meta[^>]+charset=["']?utf-8/i,
      /<meta[^>]+name=["']viewport["']/i,
    ],
  };

  for (const [file, patterns] of Object.entries(requirements)) {
    const absolutePath = path.join(ROOT, file);
    if (!fs.existsSync(absolutePath)) {
      fail('html', `missing ${file}`);
      continue;
    }
    const html = fs.readFileSync(absolutePath, 'utf8');
    for (const pattern of patterns) {
      if (!pattern.test(html)) fail('html', `${file} is missing ${pattern}`);
    }
  }
  pass(`${Object.keys(requirements).length} HTML entry points`);
}

function validatePinnedActions(files) {
  const workflowFiles = files.filter((file) =>
    /^\.github\/workflows\/.+\.ya?ml$/.test(file)
    && fs.existsSync(path.join(ROOT, file))
  );
  const usesPattern = /^\s*uses:\s*([^#\s]+)(?:\s*#.*)?$/;
  const pinnedPattern = /^(?:docker:\/\/|\.\/)|@[0-9a-f]{40}$/i;

  for (const file of workflowFiles) {
    const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const match = line.match(usesPattern);
      if (match && !pinnedPattern.test(match[1])) {
        fail('actions', `${file}:${index + 1} must pin "${match[1]}" to a full commit SHA`);
      }
    });
  }
  pass(`${workflowFiles.length} GitHub workflow files`);
}

function main() {
  let files;
  try {
    files = repositoryFiles();
  } catch (error) {
    console.error(`Repository discovery failed: ${error.message}`);
    process.exit(1);
  }

  validateRequiredFiles(files);
  validateUtf8(files);
  validateJavaScript(files);
  validatePython(files);
  validateJson(files);
  validateHtml();
  validatePinnedActions(files);

  if (failures.length) {
    console.error(`Repository checks failed (${failures.length}):`);
    failures.forEach((message) => console.error(`- ${message}`));
    process.exit(1);
  }

  console.log(`Repository checks passed: ${checks.join('; ')}.`);
}

main();
