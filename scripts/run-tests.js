#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`${label} could not start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}

function findPython() {
  const configured = process.env.PYTHON;
  const candidates = configured
    ? [configured]
    : (process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']);
  return candidates.find((candidate) => {
    const result = spawnSync(candidate, ['--version'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    return result.status === 0;
  });
}

run(process.execPath, ['--test'], 'Node.js tests');

const python = findPython();
if (!python) {
  console.error('Python is required to run the Baidu push unit tests.');
  process.exit(1);
}
run(
  python,
  ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py'],
  'Python tests'
);
