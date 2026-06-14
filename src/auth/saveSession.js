/**
 * One-time Google authentication script.
 *
 * Run this ONCE to log in to Google and save session cookies to disk.
 * The bot will load these cookies on every future run.
 *
 * Usage:
 *   node src/auth/saveSession.js
 *
 * What it does:
 *   1. Opens a visible Chromium window
 *   2. Navigates to Google sign-in
 *   3. Waits for you to log in manually (up to 3 minutes)
 *   4. Saves cookies + storage state to auth/session.json
 *   5. Closes the browser
 */

const { chromium } = require('playwright-extra');
const StealthPlugin = require('playwright-extra-plugin-stealth');

chromium.use(StealthPlugin());
const path = require('path');
const fs = require('fs');

const SESSION_PATH = path.join(__dirname, '../../auth/session.json');

async function saveSession() {
  console.log('[Auth] Opening browser — please sign in to Google...');

  fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  await page.goto('https://accounts.google.com');

  console.log('[Auth] Sign in to your Google account in the browser window.');
  console.log('[Auth] You have 3 minutes. The script will save and close automatically once you reach the Google home page.');

  // Wait until the user reaches Google's home page (post-login)
  try {
    await page.waitForURL(/myaccount\.google\.com|google\.com\/?$/, { timeout: 180000 });
  } catch {
    // Also accept if they navigated to meet.google.com directly
    const url = page.url();
    if (!url.includes('google.com')) {
      console.error('[Auth] Timed out waiting for login. Please try again.');
      await browser.close();
      process.exit(1);
    }
  }

  // Save full browser state: cookies + localStorage + sessionStorage
  await context.storageState({ path: SESSION_PATH });
  await browser.close();

  console.log(`[Auth] Session saved to: ${SESSION_PATH}`);
  console.log('[Auth] You can now run the bot normally with: node src/bot.js <meeting-url>');
}

saveSession().catch((err) => {
  console.error(`[Auth] Failed: ${err.message}`);
  process.exit(1);
});
