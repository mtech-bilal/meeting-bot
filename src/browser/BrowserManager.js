const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const os = require('os');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../logger');

chromium.use(StealthPlugin());

// The auth/chrome-profile dir is populated by "npm run auth" using real Chrome.
// Playwright then opens it with channel:'chrome' (same binary) so DPAPI-encrypted
// cookies can be decrypted by the same Windows user account — no copy needed.
const PROFILE_DIR = path.join(__dirname, '../../auth/chrome-profile');

class BrowserManager {
  constructor() {
    this.context = null;
    this.page = null;
  }

  async launch() {
    logger.info('Launching browser...');

    const isLinux = os.platform() === 'linux';

    // Read which Chrome profile was used during auth (Default, Profile 1, Profile 6, etc.)
    // The auth script writes bot-profile.json when it detects the signed-in profile.
    const metaFile = path.join(PROFILE_DIR, 'bot-profile.json');
    let profileName = 'Default';

    if (fs.existsSync(metaFile)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
        profileName = meta.profileName || 'Default';
        logger.info(`Loading saved Google session (Chrome profile: "${profileName}")...`);
      } catch {
        logger.warn('Could not read bot-profile.json — falling back to Default profile');
      }
    } else {
      logger.warn('No Google session found — run "npm run auth" first to sign in');
    }

    const args = [
      '--use-fake-ui-for-media-stream',        // auto-accept mic/camera permission dialogs
      '--use-fake-device-for-media-stream',     // provide a fake device so Chrome doesn't error
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-restore-last-session',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      // Tell Chrome which profile to load (Default, Profile 1, Profile 6, etc.)
      // IMPORTANT: launchPersistentContext sets --user-data-dir to PROFILE_DIR,
      // so --profile-directory selects the subfolder within it.
      `--profile-directory=${profileName}`,
    ];

    if (isLinux) {
      args.push('--use-file-for-fake-audio-capture=/dev/zero');
    }

    // Use system Chrome on Windows/Mac so it can decrypt DPAPI-encrypted cookies
    // from the profile that "npm run auth" created with real Chrome.
    // Fall back to Playwright's Chromium on Linux/Docker (no DPAPI issue there).
    const launchOptions = {
      headless: config.headless,
      args,
      viewport: { width: 1280, height: 720 },
      ...(isLinux ? {} : { channel: 'chrome' }),
    };

    // launchPersistentContext takes the user-data-dir (parent), not the profile subfolder
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
