# Meeting Bot — Design Spec
**Date:** 2026-06-14
**Status:** Approved

---

## Overview

A self-hosted, terminal-only Node.js application that accepts a Google Meet URL, automatically joins the meeting as a silent bot, records the meeting audio, and upon meeting end, transcribes the recording via Deepgram with speaker diarization. All outputs are saved locally. No web UI, no database, no authentication system.

**Entry point:**
```bash
node src/bot.js "https://meet.google.com/abc-defg-hij"
# or
npm start -- "https://meet.google.com/abc-defg-hij"
```

---

## Architecture

Event-driven pipeline using Node.js `EventEmitter`. `bot.js` wires all modules together and starts the flow. Each module emits events at stage boundaries; the next stage subscribes and reacts. This keeps modules independently testable and makes adding new platforms (Zoom, Teams) a matter of adding a new adapter without touching existing code.

**Event flow:**
```
bot:start
  → browser:ready
  → meeting:joining
  → meeting:joined
  → recording:started
  → meeting:ended
  → recording:stopped
  → transcription:started
  → transcription:complete
  → bot:done
```

**Project structure:**
```
meeting-bot/
├── src/
│   ├── bot.js                          ← entry point + event wiring
│   ├── config/
│   │   └── index.js                    ← loads .env, validates, exports frozen config
│   ├── logger/
│   │   └── index.js                    ← winston logger, console transport
│   ├── browser/
│   │   └── BrowserManager.js           ← Playwright Chromium launcher
│   ├── meeting/
│   │   ├── MeetingManager.js           ← platform detection, adapter instantiation
│   │   └── adapters/
│   │       └── GoogleMeetAdapter.js    ← all Google Meet DOM interactions
│   ├── recorder/
│   │   └── AudioRecorder.js            ← FFmpeg child process, PulseAudio on Linux
│   ├── transcription/
│   │   └── DeepgramClient.js           ← upload WAV, parse response, save outputs
│   └── utils/
│       └── cleanup.js                  ← SIGINT/SIGTERM/uncaughtException handler
├── recordings/                         ← gitignored, output folder
├── docker/
├── Dockerfile
├── docker-compose.yml
├── entrypoint.sh
├── package.json
├── .env
├── .env.example
└── README.md
```

---

## Module Details

### `config/index.js`
- Loads `.env` via `dotenv` at startup
- Validates `DEEPGRAM_API_KEY` is present; exits with clear error if missing
- Exports a single frozen config object — no other module calls `process.env` directly
- Config values: `DEEPGRAM_API_KEY`, `BOT_NAME`, `HEADLESS`, `DEEPGRAM_MODEL`, `ADMISSION_TIMEOUT_MS`, `MAX_MEETING_DURATION_MS`

### `logger/index.js`
- Winston logger, console transport only
- `info` level for lifecycle messages, `error` for failures with stack traces
- Required log messages (in order): `Launching browser...`, `Joining meeting...`, `Waiting for approval...`, `Joined meeting`, `Recording started`, `Recording stopped`, `Uploading to Deepgram`, `Generating transcript`, `Finished`, `Meeting ended`

### `browser/BrowserManager.js`
- Wraps Playwright `chromium.launch()`
- `HEADLESS=false` + Xvfb in Docker = visible window rendered to virtual display
- `HEADLESS=false` on Windows = real visible Chrome window (for local dev)
- Required Chromium flags:
  - `--use-fake-ui-for-media-stream` — auto-grants mic/camera in browser
  - `--use-file-for-fake-audio-capture=/dev/zero` — sends silence as mic input (Linux); omitted on Windows
  - `--no-sandbox`, `--disable-setuid-sandbox` — required in Docker
  - `--disable-gpu` — headless stability
- Browser context grants `['microphone', 'camera']` permissions
- Exposes `launch()` → returns `{ browser, context, page }`, and `close()`

### `meeting/MeetingManager.js`
- Detects platform from URL (e.g., `meet.google.com` → GoogleMeet)
- Instantiates the correct adapter
- Provides the extensibility point: adding Zoom later means adding `ZoomAdapter.js` and a URL match here
- All adapters implement the same interface: `join()`, `waitForAdmission()`, `detectEnd()`, `leave()`

### `meeting/adapters/GoogleMeetAdapter.js`
- All Google Meet DOM selectors stored as named constants at the top of the file
- `join()`: fills bot name, disables mic button, disables camera button, clicks "Ask to join" / "Join now"
- `waitForAdmission()`: polls until admitted or `ADMISSION_TIMEOUT_MS` exceeded; detects "You've been removed" overlay
- `detectEnd()`: combination strategy —
  1. Watches for "The call has ended" / "Meeting ended" DOM overlay (host ended)
  2. Polls participant count; triggers when drops to zero (everyone left quietly)
  - Whichever fires first wins; resolves the returned promise
- `leave()`: clicks the hang-up button, waits for navigation away from meet URL

### `recorder/AudioRecorder.js`
- Spawns FFmpeg as a child process
- **On Linux/Docker:** reads `Virtual_Speaker.monitor` PulseAudio source
- **On Windows:** reads default system audio loopback (uses `dshow` or `wasapi` input device)
- Output: `recordings/<timestamp>/meeting.wav`, PCM 16-bit, 16kHz, mono
- `startRecording(outputPath)` → spawns FFmpeg, returns process handle
- `stopRecording()` → sends SIGINT to FFmpeg for clean WAV finalization
- On FFmpeg crash: emits `recorder:error`, logs full stderr output

### `transcription/DeepgramClient.js`
- `uploadToDeepgram(wavPath)`: reads file, checks size > 1KB before uploading; skips with warning if empty
- Deepgram options: `diarize: true`, `model: config.DEEPGRAM_MODEL`, `smart_format: true`, `utterances: true`, `punctuate: true`
- `saveTranscript(result, outputDir)`:
  - Saves `transcript.json` — full raw Deepgram API response
  - Saves `transcript.txt` — formatted as:
    ```
    [00:01] Speaker 0
    Hello everyone.

    [00:08] Speaker 1
    Good morning.
    ```
- On API failure: logs full error, saves partial response if available, does not crash

### `utils/cleanup.js`
- Registers handlers for `SIGINT`, `SIGTERM`, `uncaughtException`
- Cleanup sequence: stop FFmpeg → close browser → log `Meeting ended` → exit
- Called once at startup; receives references to recorder and browser instances

---

## Output Structure

Each run creates a timestamped folder:
```
recordings/
└── 2026-06-14T10-30-00/
    ├── meeting.wav        ← raw audio (16-bit PCM, 16kHz, mono)
    ├── transcript.json    ← full Deepgram API response
    └── transcript.txt     ← formatted speaker transcript
```

---

## Configuration (`.env.example`)

```env
DEEPGRAM_API_KEY=
BOT_NAME=Meeting Recorder Bot
HEADLESS=false
DEEPGRAM_MODEL=nova-2
ADMISSION_TIMEOUT_MS=120000
MAX_MEETING_DURATION_MS=7200000
```

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Missing/invalid URL | Validate format before browser launch; exit with message |
| Missing `DEEPGRAM_API_KEY` | Config validation at startup; exit before anything launches |
| Meeting not found | Playwright navigation error caught; log and exit cleanly |
| Waiting room timeout | `ADMISSION_TIMEOUT_MS` exceeded; leave and exit cleanly |
| Host rejected bot | "You've been removed" overlay detected; log and exit cleanly |
| Browser crash | `browser.on('disconnected')` triggers cleanup |
| FFmpeg crash | `recorder:error` emitted; attempt transcription if WAV file exists |
| Empty recording | File size check before upload; skip Deepgram, warn, exit cleanly |
| Deepgram API failure | Log full error; save partial response; continue to exit cleanly |
| Network disconnect | Playwright timeouts caught per-operation; cleanup and exit |

---

## Docker Environment

`entrypoint.sh` startup sequence:
1. Start Xvfb on `:99` (virtual display)
2. Start PulseAudio daemon
3. Create `Virtual_Speaker` null sink
4. Set `Virtual_Speaker` as default sink
5. Load `module-loopback`
6. `exec "$@"` — run the Node.js process

`docker-compose.yml` passes the meeting URL via environment variable or command override:
```bash
docker compose run bot node src/bot.js "https://meet.google.com/abc-defg-hij"
```

---

## Platform Extensibility

To add Zoom later:
1. Create `src/meeting/adapters/ZoomAdapter.js` implementing the same 4-method interface
2. Add URL match (`zoom.us`) in `MeetingManager.js`
3. No changes to any other module

---

## Out of Scope

- Web UI, dashboard, React, Next.js, Supabase, database, authentication
- Live/real-time transcription streaming
- Zoom or Teams support (architecture supports it; implementation deferred)
- Windows audio loopback (AudioRecorder will log a warning on Windows; Docker is the production target)
