const config = require('../../config');
const logger = require('../../logger');

// All selectors in one place — update here when Google changes their UI
// NOTE: Playwright does NOT support comma-separated multi-selectors in text= pseudo-class.
//       Use arrays and check each with .or() or loop instead.
const SELECTORS = {
  // The name input shown in the pre-join lobby
  nameInput: [
    '[aria-label="Your name"]',
    'input[placeholder*="name" i]',
    'input[jsname="YPqjbf"]',  // current Google Meet lobby name field
  ].join(', '),

  // Join / Ask to join button — checked via multiple text variants
  joinButtonTexts: ['Ask to join', 'Join now', 'Join'],

  // Admitted: we're in the call — look for the leave/hangup button appearing
  admittedIndicators: [
    'button[aria-label*="Leave call" i]',
    'button[aria-label*="Hang up" i]',
    '[data-call-ended="false"]',
    '[jsname="CQylAd"]',   // meeting toolbar container (current)
  ],

  // Overlay messages that mean we were removed or the call ended
  removedOverlayTexts: [
    "you've been removed",
    "you have been removed",
    "removed from the meeting",
  ],

  meetingEndedTexts: [
    "this call has ended",
    "the call has ended",
    "meeting ended",
    "call ended",
  ],

  // Sign-in wall — bot needs an authenticated session
  signInTexts: [
    "sign in",
    "to join this call, sign in",
    "you need to sign in",
  ],

  // Hard-fail screens
  cantJoinTexts: [
    "you can't join this video call",
    "you can't join this meeting",
    "this meeting has already ended",
    "invalid meeting code",
    "no permission to join",
  ],

  micButton: [
    'button[aria-label*="Turn off microphone" i]',
    'button[aria-label*="microphone" i][aria-pressed="false"]',
    'button[data-is-muted="false"][aria-label*="mic" i]',
  ].join(', '),

  cameraButton: [
    'button[aria-label*="Turn off camera" i]',
    'button[aria-label*="camera" i][aria-pressed="false"]',
    'button[data-is-muted="false"][aria-label*="cam" i]',
  ].join(', '),

  hangupButton: [
    'button[aria-label*="Leave call" i]',
    'button[aria-label*="Hang up" i]',
    'button[jsname="CQylAd"]',
  ].join(', '),

  participantItem: '[data-participant-id], [data-requested-participant-id]',
};

// Helper: check if any of a list of text strings appear as visible text on the page
async function pageHasText(page, texts) {
  for (const text of texts) {
    try {
      const el = page.getByText(text, { exact: false }).first();
      const visible = await el.isVisible({ timeout: 1000 }).catch(() => false);
      if (visible) return { found: true, text };
    } catch {
      // keep checking
    }
  }
  return { found: false };
}

class GoogleMeetAdapter {
  constructor(page) {
    this.page = page;
  }

  async join(meetingUrl) {
    logger.info('Navigating to meeting URL...');

    await this.page.goto(meetingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for initial page render
    await this.page.waitForTimeout(3000);

    // --- Detect sign-in wall first (most common failure for bots) ---
    const signInCheck = await pageHasText(this.page, SELECTORS.signInTexts);
    if (signInCheck.found) {
      throw new Error(
        `Google Meet is asking the bot to sign in ("${signInCheck.text}").\n` +
        'Fix: Run "npm run auth" to save a Google session, then retry.'
      );
    }

    // --- Detect hard-fail screens ---
    const cantJoinCheck = await pageHasText(this.page, SELECTORS.cantJoinTexts);
    if (cantJoinCheck.found) {
      throw new Error(
        `Cannot join this meeting: "${cantJoinCheck.text}"\n` +
        'The meeting may be invalid, require a Google account, or have already ended.'
      );
    }

    // --- Fill in bot display name ---
    try {
      await this.page.waitForSelector(SELECTORS.nameInput, { timeout: 10000 });
      await this.page.fill(SELECTORS.nameInput, config.botName);
      logger.info(`Entered bot name: ${config.botName}`);
    } catch {
      logger.warn('Name input not found — may already be in meeting lobby or signed in');
    }

    // --- Mute mic before joining (avoid joining with mic on) ---
    try {
      const micBtn = this.page.locator(SELECTORS.micButton).first();
      if (await micBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await micBtn.click();
        logger.info('Microphone muted');
      }
    } catch { /* non-fatal */ }

    // --- Disable camera before joining ---
    try {
      const camBtn = this.page.locator(SELECTORS.cameraButton).first();
      if (await camBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await camBtn.click();
        logger.info('Camera disabled');
      }
    } catch { /* non-fatal */ }

    // --- Click join / ask to join button ---
    logger.info('Looking for join button...');
    let joinClicked = false;

    for (const text of SELECTORS.joinButtonTexts) {
      try {
        const btn = this.page.getByRole('button', { name: text, exact: false }).first();
        const visible = await btn.isVisible({ timeout: 5000 }).catch(() => false);
        if (visible) {
          await btn.click();
          logger.info(`Clicked "${text}" button`);
          joinClicked = true;
          break;
        }
      } catch { /* try next */ }
    }

    if (!joinClicked) {
      // Fallback: screenshot the page and throw a descriptive error
      const screenshotPath = require('path').join(__dirname, '../../../recordings/debug-join-failure.png');
      await this.page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      throw new Error(
        'Could not find a join button on the page.\n' +
        `Screenshot saved to: ${screenshotPath}\n` +
        'This usually means: (1) the bot needs to be signed into Google, or (2) Google changed their Meet UI selectors.'
      );
    }
  }

  async waitForAdmission() {
    logger.info('Waiting for host to admit the bot...');
    const deadline = Date.now() + config.admissionTimeoutMs;

    while (Date.now() < deadline) {
      // Check if rejected/removed
      const removedCheck = await pageHasText(this.page, SELECTORS.removedOverlayTexts);
      if (removedCheck.found) {
        throw new Error('The host rejected the bot from the meeting');
      }

      // Check if admitted — look for in-call UI elements
      for (const selector of SELECTORS.admittedIndicators) {
        try {
          const el = this.page.locator(selector).first();
          const visible = await el.isVisible({ timeout: 500 }).catch(() => false);
          if (visible) {
            logger.info('Successfully joined the meeting!');
            await this.page.waitForTimeout(2000); // let the call UI settle
            return;
          }
        } catch { /* keep checking */ }
      }

      await this.page.waitForTimeout(2000);
    }

    throw new Error(
      `Admission timeout after ${config.admissionTimeoutMs / 1000}s — ` +
      'the host may not have admitted the bot, or the meeting requires authentication.'
    );
  }

  async detectEnd() {
    logger.info('Monitoring meeting for end conditions...');

    return new Promise((resolve) => {
      const POLL_INTERVAL_MS = 5000;
      const START_TIME = Date.now();
      const PARTICIPANT_CHECK_DELAY_MS = 30000;

      const interval = setInterval(async () => {
        try {
          // Strategy 1: Host ended the call — overlay appears
          const ended = await pageHasText(this.page, SELECTORS.meetingEndedTexts);
          if (ended.found) {
            clearInterval(interval);
            clearTimeout(maxTimer);
            return resolve('overlay');
          }

          // Strategy 2: Everyone left — participant list is empty
          if (Date.now() - START_TIME > PARTICIPANT_CHECK_DELAY_MS) {
            const participantCount = await this.page
              .locator(SELECTORS.participantItem)
              .count()
              .catch(() => -1);
            if (participantCount === 0) {
              clearInterval(interval);
              clearTimeout(maxTimer);
              return resolve('empty-room');
            }
          }
        } catch {
          // Page navigated away — treat as meeting ended
          clearInterval(interval);
          clearTimeout(maxTimer);
          resolve('navigation');
        }
      }, POLL_INTERVAL_MS);

      // Safety valve: leave after max duration regardless
      const maxTimer = setTimeout(() => {
        clearInterval(interval);
        logger.warn('Max meeting duration reached — leaving');
        resolve('timeout');
      }, config.maxMeetingDurationMs);
    });
  }

  async leave() {
    try {
      const hangup = this.page.locator(SELECTORS.hangupButton).first();
      const visible = await hangup.isVisible({ timeout: 3000 }).catch(() => false);
      if (visible) {
        await hangup.click();
        await this.page.waitForTimeout(2000);
      }
    } catch {
      // Already left or page closed — no action needed
    }
    logger.info('Left the meeting');
  }
}

module.exports = GoogleMeetAdapter;
