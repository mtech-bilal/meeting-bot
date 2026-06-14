/**
 * One-time Google authentication script.
 *
 * Uses a persistent Chrome profile so Google doesn't flag it as a bot.
 * Run this ONCE. The profile is saved to auth/chrome-profile/ and reused
 * by the bot on every future run — no re-login needed.
 *
 * Usage:
 *   npm run auth
 */

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');

chromium.use(StealthPlugin());

const PROFILE_DIR = path.join(__dirname, '../../auth/chrome-profile');

async function saveSession() {
  console.log('[Auth] Opening browser — please sign in to your Google account...');
  console.log('[Auth] Profile will be saved to:', PROFILE_DIR);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
    viewport: { width: 1280, height: 720 },
  });

  const page = await context.newPage();
  await page.goto('https://accounts.google.com');

  console.log('[Auth] Sign in to Google in the browser window.');
  console.log('[Auth] The script saves automatically once you reach the Google home page (up to 3 minutes).');

  try {
    await page.waitForURL(
      (url) => url.hostname === 'myaccount.google.com' || (url.hostname === 'www.google.com' && !url.pathname.includes('signin')),
      { timeout: 180000 }
    );
  } catch {
    const url = page.url();
    if (!url.includes('google.com')) {
      console.error('[Auth] Timed out. Please run again and complete sign-in within 3 minutes.');
      await context.close();
      process.exit(1);
    }
  }

  await context.close();

  console.log('[Auth] Google session saved successfully!');
  console.log('[Auth] Run the bot with: node src/bot.js <meeting-url>');
}

saveSession().catch((err) => {
  console.error(`[Auth] Failed: ${err.message}`);
  process.exit(1);
});
