/**
 * One-time Google authentication script.
 *
 * Uses your installed Google Chrome (not Playwright's Chromium) so Google
 * doesn't block the sign-in. The session is saved to auth/chrome-profile/
 * and reused by the bot on every future run.
 *
 * Requires: Google Chrome installed on your system.
 * Chrome must be fully closed before running this script.
 *
 * Usage:
 *   npm run auth
 */

const { chromium } = require('playwright');
const path = require('path');

const PROFILE_DIR = path.join(__dirname, '../../auth/chrome-profile');

async function saveSession() {
  console.log('[Auth] Opening Google Chrome — please sign in to your Google account...');
  console.log('[Auth] NOTE: Close all Chrome windows before running this script.');
  console.log('[Auth] Profile will be saved to:', PROFILE_DIR);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',   // use system Chrome, not Playwright's Chromium
    headless: false,
    args: ['--no-sandbox'],
    viewport: { width: 1280, height: 720 },
  });

  const page = await context.newPage();
  await page.goto('https://accounts.google.com');

  console.log('\n[Auth] Sign in to Google in the Chrome window.');
  console.log('[Auth] The script saves automatically once you reach the Google home page.');
  console.log('[Auth] You have 3 minutes.\n');

  try {
    await page.waitForURL(
      (url) =>
        url.hostname === 'myaccount.google.com' ||
        (url.hostname === 'www.google.com' && !url.pathname.includes('signin')),
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

  console.log('\n[Auth] ✓ Google session saved to auth/chrome-profile/');
  console.log('[Auth] Run the bot with: node src/bot.js <meeting-url>');
}

saveSession().catch((err) => {
  console.error(`[Auth] Failed: ${err.message}`);
  process.exit(1);
});
