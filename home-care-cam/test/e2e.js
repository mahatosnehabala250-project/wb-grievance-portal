// End-to-end smoke test: starts the server, runs a fake camera phone and a viewer in Chromium.
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const assert = require('assert');

const PORT = 3999, BASE = `http://localhost:${PORT}`;
const env = { ...process.env, PORT, VIEW_PASSWORD: 'testpass', CAMERA_KEY: 'camkey123', NO_MOTION_HOURS: '4' };

(async () => {
  const srv = spawn('node', ['server.js'], { env, stdio: 'inherit' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  try {
    const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
    const cam = await ctx.newPage();
    cam.on('pageerror', (e) => console.log('CAM pageerror', e.message));
    await cam.goto(`${BASE}/camera?key=camkey123`);
    await cam.click('#startBtn');
    await cam.waitForSelector('#runBox:not(.hidden)');

    const vctx = await browser.newContext();
    const view = await vctx.newPage();
    view.on('pageerror', (e) => console.log('VIEW pageerror', e.message));
    await view.goto(BASE);
    await view.fill('#pw', 'wrong'); await view.click('#loginBtn');
    await view.waitForFunction(() => document.querySelector('#msg').textContent.includes('गलत'));
    await view.fill('#pw', 'testpass'); await view.click('#loginBtn');
    await view.waitForFunction(() => { const v = document.querySelector('#v'); return v.videoWidth > 0 && !v.paused; }, null, { timeout: 20000 });
    console.log('OK  live video flowing, size', await view.evaluate(() => document.querySelector('#v').videoWidth));
    assert(await view.evaluate(() => document.querySelector('#overlay').classList.contains('hidden')), 'overlay should hide');

    await view.click('#bSwitch');
    await view.waitForTimeout(1500);
    assert(await view.evaluate(() => document.querySelector('#v').videoWidth > 0), 'video after switch');
    console.log('OK  camera switch kept video alive');

    await cam.click('#pauseBtn');
    await view.waitForFunction(() => document.querySelector('#overlay').textContent.includes('रोका'), null, { timeout: 8000 });
    console.log('OK  pause shows on viewer');
    await cam.click('#pauseBtn');
    await view.waitForFunction(() => document.querySelector('#overlay').classList.contains('hidden'), null, { timeout: 8000 });
    console.log('OK  resume');

    // unauthorized checks
    const r1 = await fetch(`${BASE}/api/ice`); assert.strictEqual(r1.status, 401);
    const r2 = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"password":"x"}' }); assert.strictEqual(r2.status, 401);
    console.log('OK  auth checks');
    console.log('ALL PASSED');
  } catch (e) { console.error('FAILED', e); process.exitCode = 1; }
  finally { await browser.close(); srv.kill(); }
})();
