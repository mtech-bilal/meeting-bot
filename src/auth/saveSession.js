/**
 * Auth script — opens REAL Chrome (not Playwright) for Google sign-in.
 *
 * WHY REAL CHROME?
 *   Google blocks sign-in attempts from automated/Playwright browsers with
 *   "This browser or app may not be secure". Real Chrome bypasses this.
 *   The bot then reuses the same Chrome profile directory, so DPAPI cookie
 *   encryption works perfectly (same browser, same Windows user, same key).
 *
 * HOW IT WORKS:
 *   1. Launches Chrome with --user-data-dir pointing to auth/chrome-profile/
 *   2. You sign in to Google normally (no automation, no blocks)
 *   3. Chrome saves the authenticated session in auth/chrome-profile/
 *   4. The bot loads that same profile — Chrome decrypts its own cookies fine
 *
 * NOTE: Chrome may use "Default" or "Profile N" depending on how many
 *   Chrome profiles you have. We auto-detect which one was used.
 *
 * Usage:
 *   npm run auth
 */

const { execSync, spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PROFILE_DIR = path.join(__dirname, '../../auth/chrome-profile');
// Remove the old playwright-runtime dir if present — not needed with this approach
const RUNTIME_DIR = path.join(PROFILE_DIR, 'playwright-runtime');

function findChrome() {
  const platform = os.platform();

  if (platform === 'win32') {
    const candidates = [
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(process.env['PROGRAMFILES'] || '', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    throw new Error('Google Chrome not found. Install Chrome from https://www.google.com/chrome/');
  }

  if (platform === 'darwin') {
    const p = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (fs.existsSync(p)) return p;
    throw new Error('Google Chrome not found at ' + p);
  }

  // Linux
  for (const cmd of ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium']) {
    try { execSync(`which ${cmd}`); return cmd; } catch { /* try next */ }
  }
  throw new Error('Google Chrome / Chromium not found. Install with: sudo apt install google-chrome-stable');
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function saveSession() {
  // Clean up old playwright-runtime dir — not used with new approach
  if (fs.existsSync(RUNTIME_DIR)) {
    fs.rmSync(RUNTIME_DIR, { recursive: true, force: true });
    console.log('[Auth] Cleaned up old playwright-runtime directory.');
  }

  // Remove old session.json — not used with new approach
  const oldSession = path.join(PROFILE_DIR, 'session.json');
  if (fs.existsSync(oldSession)) {
    fs.rmSync(oldSession);
    console.log('[Auth] Removed old session.json (no longer needed).');
  }

  let chromePath;
  try {
    chromePath = findChrome();
  } catch (err) {
    console.error(`[Auth] ${err.message}`);
    process.exit(1);
  }

  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  console.log('\n[Auth] Launching REAL Chrome for Google sign-in (no automation)...');
  console.log('[Auth] Chrome will open at accounts.google.com');
  console.log('[Auth] Sign in normally — Google will NOT block you here.\n');

  // Launch real Chrome with our custom profile dir, no automation flags
  const chromeProc = spawn(
    chromePath,
    [
      `--user-data-dir=${PROFILE_DIR}`,
      '--no-first-run',
      '--no-default-browser-check',
      'https://accounts.google.com',
    ],
    { detached: true, stdio: 'ignore' }
  );
  chromeProc.unref(); // let Chrome run independently

  console.log('[Auth] Chrome is open. Please:');
  console.log('  1. Sign in to your Google account (the one that has access to your meetings)');
  console.log('  2. Wait until you can see your Google account page or Gmail');
  console.log('  3. Come back here and press Enter\n');

  await prompt('[Auth] Press Enter once you are signed in to Google...');

  console.log('\n[Auth] Closing Chrome to flush the session to disk...');

  // Kill Chrome so it writes all cookies/session data to disk before the bot reads them
  if (os.platform() === 'win32') {
    try { execSync('taskkill /F /IM chrome.exe /T', { stdio: 'ignore' }); } catch { /* already closed */ }
  } else {
    try { execSync('pkill -f chrome', { stdio: 'ignore' }); } catch { /* already closed */ }
  }

  // Wait a moment for Chrome to finish flushing
  await new Promise(r => setTimeout(r, 2000));

  // Auto-detect which profile Chrome used (Default, Profile 1, Profile 2, etc.)
  // Chrome on Windows now stores cookies in <Profile>/Network/Cookies
  const profileNames = ['Default', ...Array.from({length: 10}, (_, i) => `Profile ${i + 1}`)];
  let detectedProfile = null;
  for (const name of profileNames) {
    // Try both old path (Default/Cookies) and new path (Default/Network/Cookies)
    const oldPath = path.join(PROFILE_DIR, name, 'Cookies');
    const newPath = path.join(PROFILE_DIR, name, 'Network', 'Cookies');
    if (fs.existsSync(oldPath) || fs.existsSync(newPath)) {
      detectedProfile = name;
      break;
    }
  }

  if (!detectedProfile) {
    console.error('\n[Auth] ERROR: Session was not saved (no Cookies file found in any profile).');
    console.error('[Auth] Make sure you signed in before pressing Enter and try again.\n');
    process.exit(1);
  }

  // Save which profile Chrome used so the bot knows where to look
  const metaFile = path.join(PROFILE_DIR, 'bot-profile.json');
  fs.writeFileSync(metaFile, JSON.stringify({ profileName: detectedProfile }, null, 2));

  console.log(`\n[Auth] ✓ Google session saved (Chrome used profile: "${detectedProfile}")`);
  console.log('[Auth] Run the bot with: node src/bot.js <meeting-url>\n');
}

saveSession().catch((err) => {
  console.error(`[Auth] Failed: ${err.message}`);
  process.exit(1);
});
