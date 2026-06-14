/**
 * Copies your existing Chrome session to the bot's profile directory.
 *
 * You're already signed into Google in your regular Chrome — this script
 * copies that session so the bot can reuse it. No login screen needed.
 *
 * Requirements:
 *   - Google Chrome must be fully CLOSED before running this
 *   - You must be logged into Google in your regular Chrome
 *
 * Usage:
 *   npm run auth
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const PROFILE_DIR = path.join(__dirname, '../../auth/chrome-profile');

function getChromeProfilePath() {
  const platform = os.platform();
  if (platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data');
  }
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
  }
  // Linux
  return path.join(os.homedir(), '.config', 'google-chrome');
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

async function saveSession() {
  const chromeSrc = getChromeProfilePath();

  if (!fs.existsSync(chromeSrc)) {
    console.error(`[Auth] Chrome profile not found at: ${chromeSrc}`);
    console.error('[Auth] Make sure Google Chrome is installed and you have signed in to Google.');
    process.exit(1);
  }

  console.log('[Auth] Reading Chrome profile from:', chromeSrc);
  console.log('[Auth] IMPORTANT: Make sure all Chrome windows are fully closed first!');
  console.log('[Auth] Copying session... (this may take a few seconds)');

  // Copy the Default profile (contains cookies, localStorage, login data)
  const defaultSrc = path.join(chromeSrc, 'Default');
  const defaultDst = path.join(PROFILE_DIR, 'Default');

  if (!fs.existsSync(defaultSrc)) {
    console.error('[Auth] Chrome Default profile not found. Open Chrome at least once and sign into Google first.');
    process.exit(1);
  }

  // Clean destination to avoid stale data
  if (fs.existsSync(PROFILE_DIR)) {
    fs.rmSync(PROFILE_DIR, { recursive: true });
  }

  copyDir(defaultSrc, defaultDst);

  // Copy Local State — contains the encryption key for cookies (required on Windows)
  const localStateSrc = path.join(chromeSrc, 'Local State');
  if (fs.existsSync(localStateSrc)) {
    fs.copyFileSync(localStateSrc, path.join(PROFILE_DIR, 'Local State'));
  }

  console.log('\n[Auth] ✓ Chrome session copied to auth/chrome-profile/');
  console.log('[Auth] Run the bot with: node src/bot.js <meeting-url>');
}

saveSession().catch((err) => {
  console.error(`[Auth] Failed: ${err.message}`);
  process.exit(1);
});
