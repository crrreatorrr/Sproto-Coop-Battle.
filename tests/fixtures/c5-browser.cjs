// Shared browser helpers for the C5 acceptance specs.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..', '..');

function artifactDir(name) {
  const dir = path.join(root, 'tests', 'artifacts', name || '');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function hardware() {
  const cpu = os.cpus()[0] || {};
  return {
    host: os.hostname(),
    platform: os.platform() + ' ' + os.release(),
    cpu: cpu.model || '',
    cores: os.cpus().length,
    memoryBytes: os.totalmem(),
    node: process.version,
  };
}

async function browserVersion(browser) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(() => navigator.userAgent);
  } finally {
    await page.close();
  }
}

async function launch(playwright, name) {
  const args = ['--no-sandbox', '--disable-dev-shm-usage'];
  if (name === 'chromium') args.push('--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader');
  return playwright[name].launch({ headless: true, args: args });
}

async function shot(page, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    await page.screenshot({ path: file, timeout: 8000, animations: 'disabled' });
  } catch (err) {
    const client = await page.context().newCDPSession(page);
    try {
      const result = await client.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
    } finally {
      await client.detach().catch(() => {});
    }
  }
  return path.basename(file);
}

function writeSummary(dir, name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + '\n');
  return file;
}

module.exports = { root, artifactDir, hardware, browserVersion, launch, shot, writeSummary };
