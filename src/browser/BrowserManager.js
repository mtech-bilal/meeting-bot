const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const os = require('os');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../logger');

chromium.use(StealthPlugin());

const PROFILE_DIR = path.join(__dirname, '../../auth/chrome-profile');

class BrowserManager {
  constructor() {
    this.context = null;
    this.page = null;
  }

  async launch() {
    logger.info('Launching browser...');

    const isLinux = os.platform() === 'linux';
    const profileExists = fs.existsSync(PROFILE_DIR);

    if (!profileExists) {
      logger.warn('No Google session found — run "npm run auth" first to sign in');
    } else {
      logger.info('Loading saved Google session...');
    }

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

    // Persistent context keeps cookies, localStorage, and browser history between runs
    // Google treats this as a real returning user rather than a fresh automated browser
    this.context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: config.headless,
      args,
      permissions: ['microphone', 'camera'],
      viewport: { width: 1280, height: 720 },
    });

    this.page = await this.context.newPage();

    this.context.on('close', () => {
      logger.error('Browser context closed unexpectedly');
    });

    return { context: this.context, page: this.page };
  }

  async close() {
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
      this.page = null;
    }
  }
}

module.exports = BrowserManager;
