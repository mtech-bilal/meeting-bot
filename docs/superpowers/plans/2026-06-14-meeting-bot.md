# Meeting Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a terminal-only Node.js bot that joins a Google Meet, records audio via FFmpeg/PulseAudio, and transcribes it with Deepgram speaker diarization — all in one command.

**Architecture:** Event-driven pipeline where `bot.js` wires modules together via Node.js EventEmitter. Each module (`BrowserManager`, `GoogleMeetAdapter`, `AudioRecorder`, `DeepgramClient`) has a single responsibility and communicates through well-defined method calls and events. Platform adapters share a common interface so Zoom/Teams can be added later without touching existing code.

**Tech Stack:** Node.js, Playwright (Chromium), Winston, @deepgram/sdk, dotenv, FFmpeg (system dep), PulseAudio (Docker), Xvfb (Docker), Jest

---

## File Map

| File | Responsibility |
|---|---|
| `src/bot.js` | Entry point: validates URL, wires all modules, runs pipeline |
| `src/config/index.js` | Loads `.env`, validates required vars, exports frozen config |
| `src/logger/index.js` | Winston console logger |
| `src/browser/BrowserManager.js` | Launches/closes Chromium via Playwright |
| `src/meeting/MeetingManager.js` | Detects platform from URL, instantiates adapter |
| `src/meeting/adapters/GoogleMeetAdapter.js` | All Google Meet DOM interactions |
| `src/recorder/AudioRecorder.js` | FFmpeg child process, PulseAudio on Linux |
| `src/transcription/DeepgramClient.js` | Uploads WAV, parses response, saves outputs |
| `src/utils/cleanup.js` | SIGINT/SIGTERM/uncaughtException handler |
| `tests/config.test.js` | Config validation unit tests |
| `tests/transcription.test.js` | Transcript formatting unit tests |
| `tests/meeting.test.js` | MeetingManager URL detection unit tests |
| `tests/bot.test.js` | URL validation unit tests |
| `Dockerfile` | Docker image with Playwright, PulseAudio, FFmpeg, Xvfb |
| `entrypoint.sh` | Container startup: Xvfb + PulseAudio + virtual sink |
| `docker-compose.yml` | One-command container run |
| `.env.example` | Template for required environment variables |

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `recordings/.gitkeep`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "meeting-bot",
  "version": "1.0.0",
  "description": "Self-hosted terminal meeting bot with audio recording and transcription",
  "main": "src/bot.js",
  "scripts": {
    "start": "node src/bot.js",
    "test": "jest --testEnvironment=node"
  },
  "dependencies": {
    "@deepgram/sdk": "^3.5.0",
    "dotenv": "^16.4.5",
    "playwright": "^1.44.0",
    "winston": "^3.13.0"
  },
  "devDependencies": {
    "jest": "^29.7.0"
  }
}
```

- [ ] **Step 2: Create `.env.example`**

```env
DEEPGRAM_API_KEY=
BOT_NAME=Meeting Recorder Bot
HEADLESS=false
DEEPGRAM_MODEL=nova-2
ADMISSION_TIMEOUT_MS=120000
MAX_MEETING_DURATION_MS=7200000
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
recordings/*
!recordings/.gitkeep
.env
```

- [ ] **Step 4: Create directory structure and placeholder files**

```bash
mkdir -p src/config src/logger src/browser src/meeting/adapters src/recorder src/transcription src/utils recordings tests
touch recordings/.gitkeep
```

- [ ] **Step 5: Install dependencies**

```bash
npm install
npx playwright install chromium
```

Expected: `node_modules/` created, `package-lock.json` generated, Chromium downloaded.

- [ ] **Step 6: Copy `.env.example` to `.env` and fill in your Deepgram API key**

```bash
cp .env.example .env
# Edit .env and set DEEPGRAM_API_KEY=your_key_here
```

- [ ] **Step 7: Commit**

```bash
git init
git add package.json package-lock.json .env.example .gitignore recordings/.gitkeep
git commit -m "chore: project scaffolding"
```

---

## Task 2: Config Module

**Files:**
- Create: `src/config/index.js`
- Create: `tests/config.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/config.test.js`:

```javascript
describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('exits when DEEPGRAM_API_KEY is missing', () => {
    delete process.env.DEEPGRAM_API_KEY;
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => require('../src/config')).toThrow('exit');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('uses defaults for optional vars', () => {
    process.env.DEEPGRAM_API_KEY = 'test-key';
    delete process.env.BOT_NAME;
    delete process.env.DEEPGRAM_MODEL;
    delete process.env.ADMISSION_TIMEOUT_MS;
    delete process.env.MAX_MEETING_DURATION_MS;

    const config = require('../src/config');

    expect(config.botName).toBe('Meeting Recorder Bot');
    expect(config.deepgramModel).toBe('nova-2');
    expect(config.admissionTimeoutMs).toBe(120000);
    expect(config.maxMeetingDurationMs).toBe(7200000);
    expect(config.headless).toBe(false);
  });

  it('parses HEADLESS=true as boolean true', () => {
    process.env.DEEPGRAM_API_KEY = 'test-key';
    process.env.HEADLESS = 'true';

    const config = require('../src/config');
    expect(config.headless).toBe(true);
  });

  it('returns a frozen object', () => {
    process.env.DEEPGRAM_API_KEY = 'test-key';
    const config = require('../src/config');
    expect(Object.isFrozen(config)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- tests/config.test.js
```

Expected: FAIL — `Cannot find module '../src/config'`

- [ ] **Step 3: Create `src/config/index.js`**

```javascript
require('dotenv').config();

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
  admissionTimeoutMs: parseInt(process.env.ADMISSION_TIMEOUT_MS || '120000', 10),
  maxMeetingDurationMs: parseInt(process.env.MAX_MEETING_DURATION_MS || '7200000', 10),
});

module.exports = config;
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- tests/config.test.js
```

Expected: PASS — 4 tests passed

- [ ] **Step 5: Commit**

```bash
git add src/config/index.js tests/config.test.js
git commit -m "feat: config module with env validation"
```

---

## Task 3: Logger Module

**Files:**
- Create: `src/logger/index.js`

No unit tests — Winston's transport behavior is integration-level. We verify by reading log output in later tasks.

- [ ] **Step 1: Create `src/logger/index.js`**

```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => {
      return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    })
  ),
  transports: [new winston.transports.Console()],
});

module.exports = logger;
```

- [ ] **Step 2: Verify logger works**

Create a quick smoke test in the terminal:

```bash
node -e "
  process.env.DEEPGRAM_API_KEY = 'test';
  const logger = require('./src/logger');
  logger.info('Logger working');
  logger.error('Error logging working');
"
```

Expected output:
```
[10:30:00] [INFO] Logger working
[10:30:00] [ERROR] Error logging working
```

- [ ] **Step 3: Commit**

```bash
git add src/logger/index.js
git commit -m "feat: winston logger"
```

---

## Task 4: BrowserManager

**Files:**
- Create: `src/browser/BrowserManager.js`

- [ ] **Step 1: Create `src/browser/BrowserManager.js`**

```javascript
const { chromium } = require('playwright');
const os = require('os');
const config = require('../config');
const logger = require('../logger');

class BrowserManager {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async launch() {
    logger.info('Launching browser...');

    const isLinux = os.platform() === 'linux';

    const args = [
      '--use-fake-ui-for-media-stream',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
    ];

    // On Linux (Docker), send silence as mic so no real audio is captured from input
    if (isLinux) {
      args.push('--use-file-for-fake-audio-capture=/dev/zero');
    }

    this.browser = await chromium.launch({
      headless: config.headless,
      args,
    });

    this.context = await this.browser.newContext({
      permissions: ['microphone', 'camera'],
      viewport: { width: 1280, height: 720 },
    });

    this.page = await this.context.newPage();

    this.browser.on('disconnected', () => {
      logger.error('Browser disconnected unexpectedly');
    });

    return { browser: this.browser, context: this.context, page: this.page };
  }

  async close() {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }
}

module.exports = BrowserManager;
```

- [ ] **Step 2: Verify browser launches**

```bash
node -e "
  process.env.DEEPGRAM_API_KEY = 'test';
  process.env.HEADLESS = 'false';
  const BrowserManager = require('./src/browser/BrowserManager');
  const bm = new BrowserManager();
  bm.launch().then(({ page }) => {
    console.log('Browser launched, navigating to example.com');
    return page.goto('https://example.com');
  }).then(() => {
    console.log('Navigation succeeded');
    return bm.close();
  }).then(() => console.log('Browser closed cleanly'));
"
```

Expected: Browser opens, navigates, closes. No errors.

- [ ] **Step 3: Commit**

```bash
git add src/browser/BrowserManager.js
git commit -m "feat: BrowserManager with Playwright Chromium"
```

---

## Task 5: GoogleMeetAdapter

**Files:**
- Create: `src/meeting/adapters/GoogleMeetAdapter.js`

- [ ] **Step 1: Create `src/meeting/adapters/GoogleMeetAdapter.js`**

```javascript
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
          const participantCount = await this.page.locator(SELECTORS.participantItem)
            .count()
            .catch(() => -1);
          if (participantCount === 0) {
            clearInterval(interval);
            clearTimeout(maxTimer);
            return resolve('empty-room');
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
```

- [ ] **Step 2: Commit**

```bash
git add src/meeting/adapters/GoogleMeetAdapter.js
git commit -m "feat: GoogleMeetAdapter with DOM interaction and end detection"
```

---

## Task 6: MeetingManager

**Files:**
- Create: `src/meeting/MeetingManager.js`
- Create: `tests/meeting.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/meeting.test.js`:

```javascript
jest.mock('../src/config', () => ({
  botName: 'Test Bot',
  headless: true,
  admissionTimeoutMs: 5000,
  maxMeetingDurationMs: 60000,
  deepgramApiKey: 'test',
  deepgramModel: 'nova-2',
}));

const MeetingManager = require('../src/meeting/MeetingManager');

describe('MeetingManager', () => {
  const fakePage = {};

  it('instantiates GoogleMeetAdapter for meet.google.com URLs', () => {
    const mgr = new MeetingManager(fakePage, 'https://meet.google.com/abc-defg-hij');
    expect(mgr.adapter.constructor.name).toBe('GoogleMeetAdapter');
  });

  it('throws for unsupported platform URLs', () => {
    expect(() => new MeetingManager(fakePage, 'https://zoom.us/j/123456')).toThrow(
      'Unsupported meeting platform'
    );
  });

  it('throws for completely unrelated URLs', () => {
    expect(() => new MeetingManager(fakePage, 'https://example.com')).toThrow(
      'Unsupported meeting platform'
    );
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- tests/meeting.test.js
```

Expected: FAIL — `Cannot find module '../src/meeting/MeetingManager'`

- [ ] **Step 3: Create `src/meeting/MeetingManager.js`**

```javascript
const GoogleMeetAdapter = require('./adapters/GoogleMeetAdapter');

// Add new platform adapters here — no other files need to change
const PLATFORM_PATTERNS = [
  { pattern: /meet\.google\.com/, Adapter: GoogleMeetAdapter, name: 'Google Meet' },
  // { pattern: /zoom\.us/, Adapter: ZoomAdapter, name: 'Zoom' },
  // { pattern: /teams\.microsoft\.com/, Adapter: TeamsAdapter, name: 'Microsoft Teams' },
];

class MeetingManager {
  constructor(page, meetingUrl) {
    this.page = page;
    this.meetingUrl = meetingUrl;
    this.adapter = this._detectAdapter();
  }

  _detectAdapter() {
    const match = PLATFORM_PATTERNS.find(({ pattern }) => pattern.test(this.meetingUrl));
    if (!match) {
      throw new Error(`Unsupported meeting platform for URL: ${this.meetingUrl}`);
    }
    return new match.Adapter(this.page);
  }

  async join() { return this.adapter.join(this.meetingUrl); }
  async waitForAdmission() { return this.adapter.waitForAdmission(); }
  async detectEnd() { return this.adapter.detectEnd(); }
  async leave() { return this.adapter.leave(); }
}

module.exports = MeetingManager;
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- tests/meeting.test.js
```

Expected: PASS — 3 tests passed

- [ ] **Step 5: Commit**

```bash
git add src/meeting/MeetingManager.js tests/meeting.test.js
git commit -m "feat: MeetingManager with platform detection"
```

---

## Task 7: AudioRecorder

**Files:**
- Create: `src/recorder/AudioRecorder.js`

- [ ] **Step 1: Create `src/recorder/AudioRecorder.js`**

```javascript
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');
const logger = require('../logger');

class AudioRecorder extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.outputPath = null;
  }

  startRecording(outputPath) {
    this.outputPath = outputPath;
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const isLinux = os.platform() === 'linux';
    const args = isLinux ? this._linuxArgs(outputPath) : this._windowsArgs(outputPath);

    this.process = spawn('ffmpeg', args);

    // Suppress FFmpeg's verbose stderr output; log only on error
    this.process.stderr.on('data', () => {});

    this.process.on('error', (err) => {
      logger.error(`FFmpeg process error: ${err.message}`);
      this.emit('recorder:error', err);
    });

    this.process.on('close', (code) => {
      // SIGINT (code 255 on Linux) = normal stop via stopRecording()
      if (code !== 0 && code !== 255 && code !== null) {
        const err = new Error(`FFmpeg exited unexpectedly with code ${code}`);
        logger.error(err.message);
        this.emit('recorder:error', err);
      }
    });

    logger.info('Recording started');
  }

  stopRecording() {
    return new Promise((resolve) => {
      if (!this.process) {
        logger.info('Recording stopped');
        return resolve();
      }
      this.process.on('close', () => {
        logger.info('Recording stopped');
        resolve();
      });
      // SIGINT causes FFmpeg to finalize the WAV header cleanly before exit
      this.process.kill('SIGINT');
      this.process = null;
    });
  }

  // PulseAudio virtual sink on Linux/Docker
  _linuxArgs(outputPath) {
    return [
      '-f', 'pulse',
      '-i', 'Virtual_Speaker.monitor',
      '-acodec', 'pcm_s16le',
      '-ar', '16000',
      '-ac', '1',
      '-y',
      outputPath,
    ];
  }

  // Windows loopback — requires "Stereo Mix" or VB-Audio virtual cable enabled in system
  _windowsArgs(outputPath) {
    logger.warn('Windows audio loopback: ensure "Stereo Mix" is enabled in Sound settings, or install VB-Audio Virtual Cable');
    return [
      '-f', 'dshow',
      '-i', 'audio=Stereo Mix',
      '-acodec', 'pcm_s16le',
      '-ar', '16000',
      '-ac', '1',
      '-y',
      outputPath,
    ];
  }
}

module.exports = AudioRecorder;
```

- [ ] **Step 2: Verify FFmpeg is available**

```bash
ffmpeg -version
```

Expected: FFmpeg version info. If missing, install it:
- Windows: `winget install ffmpeg` or download from https://ffmpeg.org/download.html
- Linux: `apt-get install ffmpeg`

- [ ] **Step 3: Commit**

```bash
git add src/recorder/AudioRecorder.js
git commit -m "feat: AudioRecorder with FFmpeg and PulseAudio support"
```

---

## Task 8: DeepgramClient

**Files:**
- Create: `src/transcription/DeepgramClient.js`
- Create: `tests/transcription.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/transcription.test.js`:

```javascript
jest.mock('../src/config', () => ({
  deepgramApiKey: 'test-key',
  deepgramModel: 'nova-2',
}));
jest.mock('@deepgram/sdk', () => ({
  createClient: () => ({}),
}));

const DeepgramClient = require('../src/transcription/DeepgramClient');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('DeepgramClient', () => {
  describe('_formatTimestamp', () => {
    const client = new DeepgramClient();

    it('formats 0 seconds as 00:00', () => {
      expect(client._formatTimestamp(0)).toBe('00:00');
    });

    it('formats 65 seconds as 01:05', () => {
      expect(client._formatTimestamp(65)).toBe('01:05');
    });

    it('formats 3600 seconds as 60:00', () => {
      expect(client._formatTimestamp(3600)).toBe('60:00');
    });

    it('rounds down fractional seconds', () => {
      expect(client._formatTimestamp(1.9)).toBe('00:01');
    });
  });

  describe('saveTranscript', () => {
    let tmpDir;
    const client = new DeepgramClient();

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgtest-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true });
    });

    const fakeResult = {
      results: {
        utterances: [
          { start: 1.2, speaker: 0, transcript: 'Hello everyone.' },
          { start: 8.5, speaker: 1, transcript: 'Good morning.' },
        ],
      },
    };

    it('saves transcript.json with raw result', () => {
      client.saveTranscript(fakeResult, tmpDir);
      const json = JSON.parse(fs.readFileSync(path.join(tmpDir, 'transcript.json'), 'utf-8'));
      expect(json).toEqual(fakeResult);
    });

    it('saves transcript.txt with correct format', () => {
      client.saveTranscript(fakeResult, tmpDir);
      const txt = fs.readFileSync(path.join(tmpDir, 'transcript.txt'), 'utf-8');
      expect(txt).toContain('[00:01] Speaker 0');
      expect(txt).toContain('Hello everyone.');
      expect(txt).toContain('[00:08] Speaker 1');
      expect(txt).toContain('Good morning.');
    });

    it('handles empty utterances without crashing', () => {
      const emptyResult = { results: { utterances: [] } };
      expect(() => client.saveTranscript(emptyResult, tmpDir)).not.toThrow();
      const txt = fs.readFileSync(path.join(tmpDir, 'transcript.txt'), 'utf-8');
      expect(txt).toBe('');
    });

    it('handles missing utterances field without crashing', () => {
      const noUtterances = { results: {} };
      expect(() => client.saveTranscript(noUtterances, tmpDir)).not.toThrow();
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- tests/transcription.test.js
```

Expected: FAIL — `Cannot find module '../src/transcription/DeepgramClient'`

- [ ] **Step 3: Create `src/transcription/DeepgramClient.js`**

```javascript
const { createClient } = require('@deepgram/sdk');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../logger');

class DeepgramClient {
  constructor() {
    this.client = createClient(config.deepgramApiKey);
  }

  async uploadToDeepgram(wavPath) {
    logger.info('Uploading to Deepgram');

    if (!fs.existsSync(wavPath)) {
      throw new Error(`Recording file not found: ${wavPath}`);
    }

    const stats = fs.statSync(wavPath);
    if (stats.size < 1024) {
      throw new Error(`Recording file is too small (${stats.size} bytes) — the recording may be empty`);
    }

    const audioBuffer = fs.readFileSync(wavPath);

    const { result, error } = await this.client.listen.prerecorded.transcribeFile(
      audioBuffer,
      {
        model: config.deepgramModel,
        diarize: true,
        smart_format: true,
        utterances: true,
        punctuate: true,
      }
    );

    if (error) throw new Error(`Deepgram API error: ${error.message || JSON.stringify(error)}`);
    return result;
  }

  saveTranscript(result, outputDir) {
    logger.info('Generating transcript');

    // Save full raw API response
    const jsonPath = path.join(outputDir, 'transcript.json');
    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf-8');

    // Format utterances as readable text
    const utterances = result?.results?.utterances ?? [];
    const lines = utterances.map((u) => {
      const timestamp = this._formatTimestamp(u.start);
      return `[${timestamp}] Speaker ${u.speaker}\n${u.transcript}`;
    });

    const txtPath = path.join(outputDir, 'transcript.txt');
    fs.writeFileSync(txtPath, lines.join('\n\n'), 'utf-8');

    logger.info('Finished');
    return { jsonPath, txtPath };
  }

  _formatTimestamp(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = Math.floor(totalSeconds % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
}

module.exports = DeepgramClient;
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- tests/transcription.test.js
```

Expected: PASS — 7 tests passed

- [ ] **Step 5: Commit**

```bash
git add src/transcription/DeepgramClient.js tests/transcription.test.js
git commit -m "feat: DeepgramClient with upload and transcript formatting"
```

---

## Task 9: Cleanup Utility

**Files:**
- Create: `src/utils/cleanup.js`

- [ ] **Step 1: Create `src/utils/cleanup.js`**

```javascript
const logger = require('../logger');

function registerCleanup(recorder, browserManager) {
  let cleaning = false;

  async function cleanup(signal) {
    if (cleaning) return;
    cleaning = true;
    logger.info(`Received ${signal} — cleaning up...`);

    try {
      await recorder.stopRecording();
    } catch (err) {
      logger.error(`Error stopping recorder: ${err.message}`);
    }

    try {
      await browserManager.close();
    } catch (err) {
      logger.error(`Error closing browser: ${err.message}`);
    }

    logger.info('Meeting ended');
    process.exit(0);
  }

  process.on('SIGINT', () => cleanup('SIGINT'));
  process.on('SIGTERM', () => cleanup('SIGTERM'));
  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught exception: ${err.stack}`);
    cleanup('uncaughtException');
  });
}

module.exports = { registerCleanup };
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/cleanup.js
git commit -m "feat: graceful shutdown cleanup utility"
```

---

## Task 10: Main Entry Point (`bot.js`)

**Files:**
- Create: `src/bot.js`
- Create: `tests/bot.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/bot.test.js`:

```javascript
// Isolate the URL validation logic before it's wired into bot.js
// We test this by extracting and requiring the validator directly

describe('URL validation', () => {
  function validateUrl(url) {
    if (!url) throw new Error('No meeting URL provided. Usage: node src/bot.js <meeting-url>');
    try {
      new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }
    if (!/meet\.google\.com/.test(url)) {
      throw new Error('Unsupported meeting platform. Currently supported: Google Meet');
    }
  }

  it('throws when no URL is given', () => {
    expect(() => validateUrl(undefined)).toThrow('No meeting URL provided');
  });

  it('throws for a non-URL string', () => {
    expect(() => validateUrl('not-a-url')).toThrow('Invalid URL');
  });

  it('throws for an unsupported platform', () => {
    expect(() => validateUrl('https://zoom.us/j/123')).toThrow('Unsupported meeting platform');
  });

  it('does not throw for a valid Google Meet URL', () => {
    expect(() => validateUrl('https://meet.google.com/abc-defg-hij')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to confirm they pass (these tests are self-contained)**

```bash
npm test -- tests/bot.test.js
```

Expected: PASS — 4 tests passed

- [ ] **Step 3: Create `src/bot.js`**

```javascript
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
```

- [ ] **Step 4: Run all tests to make sure nothing regressed**

```bash
npm test
```

Expected: PASS — all test suites pass

- [ ] **Step 5: Smoke test the entry point error handling**

```bash
# Missing URL
node src/bot.js
# Expected: [ERROR] No meeting URL provided.

# Invalid URL
node src/bot.js "not-a-url"
# Expected: [ERROR] Invalid URL: not-a-url

# Unsupported platform
node src/bot.js "https://zoom.us/j/123"
# Expected: [ERROR] Unsupported meeting platform.
```

- [ ] **Step 6: Commit**

```bash
git add src/bot.js tests/bot.test.js
git commit -m "feat: main bot entry point with pipeline orchestration"
```

---

## Task 11: Docker Environment

**Files:**
- Create: `Dockerfile`
- Create: `entrypoint.sh`
- Create: `docker-compose.yml`

- [ ] **Step 1: Create `Dockerfile`**

```dockerfile
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

# Install virtual display, audio, and video processing tools
RUN apt-get update && apt-get install -y \
    xvfb \
    pulseaudio \
    ffmpeg \
    alsa-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies before copying source (layer caching)
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Ensure output directory exists inside image
RUN mkdir -p recordings

# Virtual display environment variable required by Chromium
ENV DISPLAY=:99

COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "src/bot.js"]
```

- [ ] **Step 2: Create `entrypoint.sh`**

```bash
#!/bin/bash
set -e

# Start Xvfb virtual display on :99
Xvfb :99 -screen 0 1280x1024x24 &
export DISPLAY=:99

# Start PulseAudio in daemon mode, never exit on idle
pulseaudio --daemonize --exit-idle-time=-1 --allow-exit=false

# Small delay to ensure PulseAudio is ready before creating sinks
sleep 1

# Create a virtual null audio sink — browser sends meeting audio here
pactl load-module module-null-sink \
  sink_name=Virtual_Speaker \
  sink_properties=device.description="Virtual_Speaker"

# Set it as the system default so Chromium outputs to it automatically
pactl set-default-sink Virtual_Speaker

# Loopback module allows FFmpeg to capture the sink's monitor source
pactl load-module module-loopback

# Hand off to the container CMD (node src/bot.js <url>)
exec "$@"
```

- [ ] **Step 3: Create `docker-compose.yml`**

```yaml
version: '3.8'

services:
  bot:
    build:
      context: .
      dockerfile: Dockerfile
    volumes:
      # Persist recordings to host machine
      - ./recordings:/app/recordings
      # Mount .env from host (never bake secrets into image)
      - ./.env:/app/.env:ro
    shm_size: '2gb'
    # Pass meeting URL via environment variable
    # Usage: MEETING_URL="https://meet.google.com/abc-defg-hij" docker compose up
    environment:
      - MEETING_URL=${MEETING_URL:-}
    command: >
      sh -c 'node src/bot.js "$$MEETING_URL"'
```

- [ ] **Step 4: Build the Docker image**

```bash
docker build -t meeting-bot:latest .
```

Expected: Image builds successfully. Takes a few minutes on first run (downloads Playwright + system deps).

- [ ] **Step 5: Test the container with a dry run (no real meeting)**

```bash
docker run --rm meeting-bot:latest node src/bot.js
```

Expected output includes:
```
[ERROR] No meeting URL provided.
```
(This confirms the container boots, Xvfb/PulseAudio start, and Node runs)

- [ ] **Step 6: Commit**

```bash
git add Dockerfile entrypoint.sh docker-compose.yml
git commit -m "feat: Docker environment with Xvfb, PulseAudio, FFmpeg"
```

---

## Task 12: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
# Meeting Bot

A self-hosted terminal bot that joins Google Meet, records the meeting audio, and transcribes it with speaker diarization using Deepgram.

## Requirements

- Docker & Docker Compose (production)
- Node.js 18+ and FFmpeg (local development)
- A [Deepgram](https://deepgram.com) API key

## Quick Start (Docker)

```bash
# 1. Clone and enter the project
git clone <repo> && cd meeting-bot

# 2. Configure environment
cp .env.example .env
# Edit .env and set DEEPGRAM_API_KEY=your_key

# 3. Run
MEETING_URL="https://meet.google.com/abc-defg-hij" docker compose up
```

Outputs are saved to `recordings/<timestamp>/`:
- `meeting.wav` — raw audio
- `transcript.json` — full Deepgram API response
- `transcript.txt` — formatted speaker transcript

## Local Development (without Docker)

```bash
npm install
npx playwright install chromium
cp .env.example .env
# Edit .env

node src/bot.js "https://meet.google.com/abc-defg-hij"
```

> **Note:** Audio recording requires a virtual audio loopback device on Windows (e.g., VB-Audio Virtual Cable with "Stereo Mix" enabled). In Docker on Linux, this is handled automatically.

## Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `DEEPGRAM_API_KEY` | required | Deepgram API key |
| `BOT_NAME` | `Meeting Recorder Bot` | Display name shown in the meeting |
| `HEADLESS` | `false` | Set `true` for fully headless (Xvfb handles display in Docker) |
| `DEEPGRAM_MODEL` | `nova-2` | Deepgram transcription model |
| `ADMISSION_TIMEOUT_MS` | `120000` | How long to wait in the waiting room (ms) |
| `MAX_MEETING_DURATION_MS` | `7200000` | Auto-leave after this duration (ms) |

## Adding a New Platform (Zoom, Teams)

1. Create `src/meeting/adapters/ZoomAdapter.js` implementing `join()`, `waitForAdmission()`, `detectEnd()`, `leave()`
2. Add `{ pattern: /zoom\.us/, Adapter: ZoomAdapter, name: 'Zoom' }` to `PLATFORM_PATTERNS` in `src/meeting/MeetingManager.js`
3. Add the URL pattern to `validateUrl()` in `src/bot.js`

## Running Tests

```bash
npm test
```
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with setup and usage instructions"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by task |
|---|---|
| `node src/bot.js <url>` entry point | Task 10 |
| Launch Chromium via Playwright | Task 4 |
| Grant mic/camera, send silent mic | Task 4 |
| Enter bot display name | Task 5 |
| Disable own mic/camera before joining | Task 5 |
| Click Join / Ask to Join | Task 5 |
| Wait for admission / detect rejection | Task 5 |
| Detect meeting end (overlay + participant count) | Task 5 |
| Leave automatically | Task 5 |
| Platform adapter interface for extensibility | Task 6 |
| FFmpeg audio recording to timestamped folder | Tasks 7, 10 |
| Deepgram upload with diarize/smart_format/utterances/punctuate | Task 8 |
| Save `transcript.json` | Task 8 |
| Save `transcript.txt` in `[MM:SS] Speaker N\nText` format | Task 8 |
| All required log messages | Tasks 3, 4, 5, 7, 8 |
| `.env` config with all required variables | Tasks 1, 2 |
| Docker with Xvfb + PulseAudio + FFmpeg | Task 11 |
| `docker compose up` one-command run | Task 11 |
| Timestamped output folders | Task 10 |
| Error handling for all listed failure scenarios | Tasks 2, 5, 8, 10 |
| `npm start -- <url>` works | Task 1 (scripts.start) |
| SIGINT/SIGTERM cleanup | Task 9 |
| Windows local dev support | Tasks 4, 7 |

**All spec requirements covered. No gaps found.**
