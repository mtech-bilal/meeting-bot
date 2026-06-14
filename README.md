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

## Running Tests

```bash
npm test
```

## Adding a New Platform (Zoom, Teams)

1. Create `src/meeting/adapters/ZoomAdapter.js` implementing `join()`, `waitForAdmission()`, `detectEnd()`, `leave()`
2. Add `{ pattern: /zoom\.us/, Adapter: ZoomAdapter, name: 'Zoom' }` to `PLATFORM_PATTERNS` in `src/meeting/MeetingManager.js`
3. Add the URL pattern to `validateUrl()` in `src/bot.js`

## Project Structure

```
src/
├── bot.js                          ← entry point
├── config/index.js                 ← env var loading and validation
├── logger/index.js                 ← winston logger
├── browser/BrowserManager.js       ← Playwright Chromium launcher
├── meeting/
│   ├── MeetingManager.js           ← platform detection
│   └── adapters/
│       └── GoogleMeetAdapter.js    ← Google Meet DOM interactions
├── recorder/AudioRecorder.js       ← FFmpeg audio capture
├── transcription/DeepgramClient.js ← Deepgram upload and transcript saving
└── utils/cleanup.js                ← graceful shutdown
```
