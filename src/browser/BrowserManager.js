const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

chromium.use(StealthPlugin());
const os = require('os');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../logger');

const SESSION_PATH = path.join(__dirname, '../../auth/session.json');

class BrowserManager {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async launch() {
    logger.info('Launching browser...');

    const isLinux = os.platform() === 'linux';

    const args = [
      '--use-fake-ui-for-media-stream',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
    ];

    // On Linux (Docker), send silence as mic so no real audio is captured from input
    if (isLinux) {
      args.push('--use-file-for-fake-audio-capture=/dev/zero');
    }

    this.browser = await chromium.launch({
      headless: config.headless,
      args,
    });

    const sessionExists = fs.existsSync(SESSION_PATH);
    if (sessionExists) {
      logger.info('Loading saved Google session...');
    } else {
      logger.warn('No saved session found — run "node src/auth/saveSession.js" first if the meeting requires a Google account');
    }

    this.context = await this.browser.newContext({
      permissions: ['microphone', 'camera'],
      viewport: { width: 1280, height: 720 },
      ...(sessionExists && { storageState: SESSION_PATH }),
    });

    this.page = await this.context.newPage();

    this.browser.on('disconnected', () => {
      logger.error('Browser disconnected unexpectedly');
    });

    return { browser: this.browser, context: this.context, page: this.page };
  }

  async close() {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }
}

module.exports = BrowserManager;
