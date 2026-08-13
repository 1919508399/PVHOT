'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

test('announcement dialog persists dismissal and exposes complete keyboard handling', () => {
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

  assert.match(app, /const ANNOUNCEMENT_DISMISSED_KEY = "pvhot-announcement-dismissed-v1"/);
  assert.match(app, /localStorage\.getItem\(ANNOUNCEMENT_DISMISSED_KEY\)/);
  assert.match(app, /localStorage\.setItem\(ANNOUNCEMENT_DISMISSED_KEY, signature\)/);
  assert.match(app, /sessionStorage\.setItem\(ANNOUNCEMENT_DISMISSED_KEY, signature\)/);
  assert.match(app, /if \(event\.key === "Escape"\)/);
  assert.match(app, /if \(event\.key !== "Tab"\) return/);
  assert.match(app, /event\.shiftKey && document\.activeElement === first/);
  assert.match(app, /!event\.shiftKey && document\.activeElement === last/);
  assert.match(app, /announcementReturnFocus\.focus\(\{ preventScroll: true \}\)/);
  assert.match(app, /setTimeout\(\(\) =>/);
  assert.match(app, /focusTarget\.focus\(\{ preventScroll: true \}\)/);
});

test('announcement markup starts non-interactive and has dialog semantics', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

  assert.match(html, /id="featuredAnnouncementModal" aria-hidden="true"/);
  assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="featuredAnnouncementTitle"/);
  assert.match(html, /data-announcement-dismiss aria-label="关闭公告"/);
  assert.match(css, /body\.announcement-open \{ overflow: hidden; \}/);
});
