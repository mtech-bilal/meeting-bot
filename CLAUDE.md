# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Model

When spawning subagents, use `claude-sonnet-4-6`.

## What This Project Is

A self-hosted terminal-only Node.js bot that joins a Google Meet, records the audio via FFmpeg/PulseAudio, and produces a speaker-diarized transcript via Deepgram. No web UI, no database, no authentication system. The production target is Docker on Linux; Windows is supported for local development only.

**Run the bot:**
```bash
node src/bot.js "https://meet.google.com/abc-defg-hij"
# or
npm start -- "https://meet.google.com/abc-defg-hij"
```

**Run tests:**
```bash
npm test                              # all suites
npm test -- tests/config.test.js     # single suite
```

**Docker (production):**
```bash
docker build -t meeting-bot:latest .
MEETING_URL="https://meet.google.com/abc-defg-hij" docker compose up
```

**Install dependencies (first time):**
```bash
npm install
npx playwright install chromium
```

## Architecture

Event-driven pipeline. `src/bot.js` wires all modules together and runs the pipeline sequentially. Modules communicate through method calls; `AudioRecorder` extends `EventEmitter` for error signaling.

**Pipeline stages:**
```
validateUrl → BrowserManager.launch() → MeetingManager.join()
  → waitForAdmission() → AudioRecorder.startRecording()
  → detectEnd() → leave() → stopRecording() → DeepgramClient.uploadToDeepgram()
  → saveTranscript() → exit
```

**Module responsibilities:**

| File | Responsibility |
|---|---|
| `src/bot.js` | Entry point: URL validation, module wiring, pipeline execution |
| `src/config/index.js` | Loads `.env` via dotenv, validates `DEEPGRAM_API_KEY`, exports a frozen config object — **the only file that reads `process.env`** |
| `src/logger/index.js` | Winston console logger with `[HH:mm:ss] [LEVEL] message` format |
| `src/browser/BrowserManager.js` | Launches/closes Chromium via Playwright; handles Linux vs Windows Chromium flags |
| `src/meeting/MeetingManager.js` | Detects platform from URL, instantiates the correct adapter, delegates all 4 methods |
| `src/meeting/adapters/GoogleMeetAdapter.js` | All Google Meet DOM interactions; all selectors in `SELECTORS` constants at top of file |
| `src/recorder/AudioRecorder.js` | Spawns FFmpeg child process; Linux uses PulseAudio `Virtual_Speaker.monitor`, Windows uses `dshow` |
| `src/transcription/DeepgramClient.js` | Uploads WAV to Deepgram, saves `transcript.json` and `transcript.txt` |
| `src/utils/cleanup.js` | Registers `SIGINT`/`SIGTERM`/`uncaughtException` handlers for graceful shutdown |

## Key Design Decisions

**Platform adapter pattern:** All meeting adapters implement the same 4-method interface: `join()`, `waitForAdmission()`, `detectEnd()`, `leave()`. To add Zoom later: create `ZoomAdapter.js`, add a URL pattern to `PLATFORM_PATTERNS` in `MeetingManager.js`, and update `validateUrl()` in `bot.js`. No other files change.

**Config is the single source of truth for env vars:** `src/config/index.js` validates and exports everything. No other module calls `process.env` directly.

**Chromium must run with `headless: false`:** In Docker, Xvfb renders the virtual display. On Windows, a real Chrome window opens. This is required for audio routing to work.

**FFmpeg finalization:** `stopRecording()` sends `SIGINT` (not `SIGKILL`) to FFmpeg so it can write the WAV header cleanly before exit.

**Meeting end detection (two strategies):** `GoogleMeetAdapter.detectEnd()` polls every 5 seconds for either (1) a "meeting ended" DOM overlay, or (2) participant count dropping to zero. A `maxMeetingDurationMs` timeout fires as a safety valve.

## Output Structure

Each run creates a timestamped folder under `recordings/` (gitignored):
```
recordings/
└── 2026-06-14T10-30-00/
    ├── meeting.wav        ← raw audio (PCM 16-bit, 16kHz, mono)
    ├── transcript.json    ← full Deepgram API response
    └── transcript.txt     ← [MM:SS] Speaker N\nText format
```

## Environment Variables (`.env`)

Copy `.env.example` to `.env` to get started.

| Variable | Default | Required |
|---|---|---|
| `DEEPGRAM_API_KEY` | — | Yes |
| `BOT_NAME` | `Meeting Recorder Bot` | No |
| `HEADLESS` | `false` | No |
| `DEEPGRAM_MODEL` | `nova-2` | No |
| `ADMISSION_TIMEOUT_MS` | `120000` | No |
| `MAX_MEETING_DURATION_MS` | `7200000` | No |

## Docker Environment

`entrypoint.sh` runs before `node src/bot.js`: starts Xvfb on `:99`, starts PulseAudio, creates a `Virtual_Speaker` null sink, sets it as default, loads `module-loopback`, then `exec "$@"`. FFmpeg captures from `Virtual_Speaker.monitor`.

`docker-compose.yml` mounts `./recordings` and `./.env` from the host; never bake secrets into the image.

## Windows Local Development Note

Audio recording on Windows requires either "Stereo Mix" enabled in Sound settings or VB-Audio Virtual Cable installed. FFmpeg uses `dshow` input with `audio=Stereo Mix`. `AudioRecorder` logs a warning when it detects Windows.

## Google Meet DOM Selectors

Google Meet changes its UI frequently. All selectors are consolidated in the `SELECTORS` constant at the top of `GoogleMeetAdapter.js` — update there when selectors break, not inline in methods.
