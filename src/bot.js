// Load and validate config first — exits immediately if DEEPGRAM_API_KEY is missing
require('./config');

const path = require('path');
const logger = require('./logger');
const BrowserManager = require('./browser/BrowserManager');
const MeetingManager = require('./meeting/MeetingManager');
const AudioRecorder = require('./recorder/AudioRecorder');
const DeepgramClient = require('./transcription/DeepgramClient');
const { registerCleanup } = require('./utils/cleanup');

function validateUrl(url) {
  if (!url) throw new Error('No meeting URL provided.\nUsage: node src/bot.js <meeting-url>');
  try {
    new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (!/meet\.google\.com/.test(url)) {
    throw new Error('Unsupported meeting platform. Currently supported: Google Meet');
  }
}

function getSessionDir() {
  const ts = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
  return path.join(__dirname, '..', 'recordings', ts);
}

async function main() {
  const meetingUrl = process.argv[2];

  try {
    validateUrl(meetingUrl);
  } catch (err) {
    logger.error(err.message);
    process.exit(1);
  }

  const sessionDir = getSessionDir();
  const wavPath = path.join(sessionDir, 'meeting.wav');

  const browserManager = new BrowserManager();
  const recorder = new AudioRecorder();
  const deepgram = new DeepgramClient();

  // Register cleanup BEFORE anything launches so Ctrl+C always cleans up
  registerCleanup(recorder, browserManager);

  try {
    const { page } = await browserManager.launch();
    const meeting = new MeetingManager(page, meetingUrl);

    await meeting.join();
    await meeting.waitForAdmission();

    recorder.startRecording(wavPath);
    recorder.on('recorder:error', (err) => {
      logger.error(`Recorder error: ${err.message}`);
    });

    const endReason = await meeting.detectEnd();
    logger.info(`Meeting ended (reason: ${endReason})`);

    await meeting.leave();
    await recorder.stopRecording();
    await browserManager.close();

    // Transcribe and save — only if recording has content
    try {
      const result = await deepgram.uploadToDeepgram(wavPath);
      const { jsonPath, txtPath } = deepgram.saveTranscript(result, sessionDir);
      logger.info(`Transcript saved:\n  JSON: ${jsonPath}\n  Text: ${txtPath}`);
    } catch (err) {
      logger.error(`Transcription failed: ${err.message}`);
    }

    logger.info(`All outputs saved to: ${sessionDir}`);
    process.exit(0);
  } catch (err) {
    logger.error(`Bot failed: ${err.message}`);
    await recorder.stopRecording().catch(() => {});
    await browserManager.close().catch(() => {});
    process.exit(1);
  }
}

main();
