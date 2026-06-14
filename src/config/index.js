require('dotenv').config();

function parseIntEnv(val, fallback) {
  const n = parseInt(val || String(fallback), 10);
  return Number.isFinite(n) ? n : fallback;
}

const REQUIRED = ['DEEPGRAM_API_KEY'];

for (const key of REQUIRED) {
  if (!process.env[key]) {
    console.error(`[Config] Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const config = Object.freeze({
  deepgramApiKey: process.env.DEEPGRAM_API_KEY,
  botName: process.env.BOT_NAME || 'Meeting Recorder Bot',
  headless: process.env.HEADLESS === 'true',
  deepgramModel: process.env.DEEPGRAM_MODEL || 'nova-2',
  admissionTimeoutMs: parseIntEnv(process.env.ADMISSION_TIMEOUT_MS, 120000),
  maxMeetingDurationMs: parseIntEnv(process.env.MAX_MEETING_DURATION_MS, 7200000),
});

module.exports = config;
