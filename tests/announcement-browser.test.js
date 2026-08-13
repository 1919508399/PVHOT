'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { once } = require('node:events');
const test = require('node:test');
const puppeteer = require('puppeteer');
const { createStaticServer } = require('../scripts/dev-server');

function installedBrowserPath() {
  const candidates = process.platform === 'win32' ? [
    process.env.PVHOT_BROWSER_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ] : [process.env.PVHOT_BROWSER_PATH];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

test('announcement dialog persists and remains keyboard accessible in Chromium', {
  skip: process.env.PVHOT_BROWSER_TEST !== '1' && 'set PVHOT_BROWSER_TEST=1 to run browser checks',
}, async () => {
  const server = createStaticServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const executablePath = installedBrowserPath();
  const browser = await puppeteer.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });

  try {
    const page = await browser.newPage();
    await page.setBypassServiceWorker(true);
    let announcementBody = '这是首次公告';
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/site_texts.json') {
        setTimeout(() => request.respond({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({ announcement: { title: '网站公告', body: announcementBody } }),
        }), 300);
        return;
      }
      request.continue();
    });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    // Wait for the main data render before choosing the focus-return target.
    // The initial render replaces the search node once; focusing before that
    // replacement makes the test race the announcement request.
    await page.waitForFunction(() => document.querySelector('#search') && document.querySelector('#top5')?.children.length > 0);
    await page.focus('#search');
    await page.waitForSelector('#featuredAnnouncementModal.show');
    await page.waitForFunction(() => document.activeElement.classList.contains('featured-announcement-ok'));
    assert.equal(await page.evaluate(() => document.activeElement.className), 'featured-announcement-ok');

    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'featured-announcement-close');
    await page.keyboard.down('Shift');
    await page.keyboard.press('Tab');
    await page.keyboard.up('Shift');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'featured-announcement-ok');

    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => {
      const modal = document.querySelector('#featuredAnnouncementModal');
      return {
        hidden: modal.getAttribute('aria-hidden'),
        inert: modal.hasAttribute('inert'),
        focus: document.activeElement.id,
        scrollLocked: document.body.classList.contains('announcement-open'),
        saved: localStorage.getItem('pvhot-announcement-dismissed-v1'),
      };
    }), {
      hidden: 'true',
      inert: true,
      focus: 'search',
      scrollLocked: false,
      saved: '网站公告\n这是首次公告',
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(
      await page.$eval('#featuredAnnouncementModal', (modal) => modal.classList.contains('show')),
      false,
      '已关闭的同一版公告刷新后不应重弹',
    );

    announcementBody = '公告正文已更新';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#featuredAnnouncementModal.show');
    assert.equal(
      await page.$eval('#featuredAnnouncementModal', (modal) => modal.getAttribute('aria-hidden')),
      'false',
      '公告内容变化后应当重新显示',
    );
  } finally {
    await browser.close();
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
