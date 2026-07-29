'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  atomicWriteBufferSync,
  atomicWriteJsonSync,
  atomicWriteUtf8Sync,
} = require('../lib/safe_io');

function temporaryDirectory(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('atomicWriteUtf8Sync replaces a UTF-8 file completely', (t) => {
  const directory = temporaryDirectory(t, 'pvhot-safe-io-');
  const target = path.join(directory, 'article.txt');
  fs.writeFileSync(target, 'old', 'utf8');

  const expected = '光伏行业数据完整更新\n第二行';
  atomicWriteUtf8Sync(target, expected);

  assert.equal(fs.readFileSync(target, 'utf8'), expected);
  assert.deepEqual(
    fs.readdirSync(directory).filter((name) => name.endsWith('.tmp')),
    []
  );
});

test('JSON validation failure keeps the old file and leaves no temporary file', (t) => {
  const directory = temporaryDirectory(t, 'pvhot-safe-json-');
  const target = path.join(directory, 'data.json');
  const oldText = '{"items":[{"id":"old"}]}';
  fs.writeFileSync(target, oldText, 'utf8');

  assert.throws(() => {
    atomicWriteJsonSync(target, { items: [] }, {
      validate(value) {
        return value.items.length > 0;
      },
    });
  }, /validation failed/i);

  assert.equal(fs.readFileSync(target, 'utf8'), oldText);
  assert.deepEqual(
    fs.readdirSync(directory).filter((name) => name.endsWith('.tmp')),
    []
  );
});

test('atomicWriteBufferSync replaces a binary asset completely', (t) => {
  const directory = temporaryDirectory(t, 'pvhot-safe-buffer-');
  const target = path.join(directory, 'image.bin');
  fs.writeFileSync(target, Buffer.from([0, 1, 2]));

  const expected = Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70]);
  atomicWriteBufferSync(target, expected);

  assert.deepEqual(fs.readFileSync(target), expected);
  assert.deepEqual(
    fs.readdirSync(directory).filter((name) => name.endsWith('.tmp')),
    []
  );
});
