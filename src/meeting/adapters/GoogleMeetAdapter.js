const config = require('../../config');
const logger = require('../../logger');

// All selectors in one place — update here when Google changes their UI
const SELECTORS = {
  nameInput: '[aria-label="Your name"], input[placeholder*="name" i], input[type="text"]',
  micButton: 'button[aria-label*="microphone" i][aria-pressed="false"], button[aria-label*="Turn off mic" i]',
  cameraButton: 'button[aria-label*="camera" i][aria-pressed="false"], button[aria-label*="Turn off camera" i]',
  joinButton: 'button:has-text("Ask to join"), button:has-text("Join now"), button:has-text("Join")',
  admittedIndicator: '[data-call-ended="false"], [jsname="Cpkphb"], [data-allocation-index]',
  removedOverlay: 'text=/you.ve been removed/i',
  meetingEndedOverlay: 'text=/this call has ended/i, text=/the call has ended/i, text=/meeting ended/i',
  participantItem: '[data-participant-id], [data-requested-participant-id]',
  hangupButton: 'button[aria-label*="Leave call" i], button[aria-label*="Hang up" i]',
};

class GoogleMeetAdapter {
  constructor(page) {
    this.page = page;
  }

  async join(meetingUrl) {
    logger.info('Joining meeting...');

    await this.page.goto(meetingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Fill in bot display name
    try {
      await this.page.waitForSelector(SELECTORS.nameInput, { timeout: 15000 });
      await this.page.fill(SELECTORS.nameInput, config.botName);
      logger.info(`Entered bot name: ${config.botName}`);
    } catch {
      logger.warn('Name input not found — may already be in meeting lobby');
    }

    // Mute mic before joining
    try {
      const micBtn = this.page.locator(SELECTORS.micButton).first();
      if (await micBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await micBtn.click();
        logger.info('Microphone disabled');
      }
    } catch {}

    // Disable camera before joining
    try {
      const camBtn = this.page.locator(SELECTORS.cameraButton).first();
      if (await camBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await camBtn.click();
        logger.info('Camera disabled');
      }
    } catch {}

    // Click join / ask to join
    const joinBtn = this.page.locator(SELECTORS.joinButton).first();
    await joinBtn.waitFor({ state: 'visible', timeout: 15000 });
    await joinBtn.click();
  }

  async waitForAdmission() {
    logger.info('Waiting for approval...');
    const deadline = Date.now() + config.admissionTimeoutMs;

    while (Date.now() < deadline) {
      // Detect if rejected
      const wasRemoved = await this.page.locator(SELECTORS.removedOverlay)
        .isVisible()
        .catch(() => false);
      if (wasRemoved) {
        throw new Error('Host rejected the bot from the meeting');
      }

      // Detect if admitted (in-call UI rendered)
      const admitted = await this.page.locator(SELECTORS.admittedIndicator)
        .first()
        .isVisible()
        .catch(() => false);
      if (admitted) {
        logger.info('Joined meeting');
        return;
      }

      await this.page.waitForTimeout(2000);
    }

    throw new Error(`Admission timeout after ${config.admissionTimeoutMs}ms — host may not have admitted the bot`);
  }

  async detectEnd() {
    logger.info('Monitoring meeting for end conditions...');

    return new Promise((resolve) => {
      const POLL_INTERVAL_MS = 5000;
      const START_TIME = Date.now();
      const PARTICIPANT_CHECK_DELAY_MS = 30000; // wait 30s before trusting participant count

      const interval = setInterval(async () => {
        try {
          // Strategy 1: Host ended the call — overlay appears
          const callEndedOverlay = await this.page.locator(SELECTORS.meetingEndedOverlay)
            .first()
            .isVisible()
            .catch(() => false);
          if (callEndedOverlay) {
            clearInterval(interval);
            clearTimeout(maxTimer);
            return resolve('overlay');
          }

          // Strategy 2: Everyone left — participant list is empty
          // Only check after delay to avoid false positives right after joining
          if (Date.now() - START_TIME > PARTICIPANT_CHECK_DELAY_MS) {
            const participantCount = await this.page.locator(SELECTORS.participantItem)
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
    logger.info('Meeting ended');
  }
}

module.exports = GoogleMeetAdapter;
