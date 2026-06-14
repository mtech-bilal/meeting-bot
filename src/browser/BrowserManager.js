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
      '--no-restore-last-session',   // don't restore previous tabs
      '--no-first-run',              // skip first-run setup screens
      '--no-default-browser-check',
    ];

    if (isLinux) {
      args.push('--use-file-for-fake-audio-capture=/dev/zero');
    }

    // Use system Chrome on Windows/Mac (avoids Google bot detection on sign-in)
    // Fall back to Playwright's Chromium on Linux/Docker where Chrome isn't installed
    const launchOptions = {
      headless: config.headless,
      args,
      permissions: ['microphone', 'camera'],
      viewport: { width: 1280, height: 720 },
      ...(isLinux ? {} : { channel: 'chrome' }),
    };

    this.context = await chromium.launchPersistentContext(PROFILE_DIR, launchOptions);
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
