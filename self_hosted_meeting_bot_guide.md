# Blueprint: Self-Hosted Meeting Recording & Diarization Bot

This document outlines the architecture, implementation steps, and code blocks required to build a self-hosted meeting bot. The bot utilizes **Node.js**, **Playwright**, and **Docker** to join meetings (Google Meet, Zoom, or Microsoft Teams), records the raw system audio, and processes it using the **Deepgram API** for live or asynchronous speaker-attributed transcription ("who said what and when").

---

## 1. System Architecture & Component Workflow

To run a headless browser capable of capturing audio without an physical sound card, the environment must simulate a virtual audio device. The workflow operates as follows:

```
+-----------------------------------------------------------------------------------+
| DOCKER CONTAINER (Linux Environment)                                              |
|                                                                                   |
|  +--------------------+      Audio Output      +-------------------------------+  |
|  | Headless Browser   | ---------------------> | Virtual Audio Device (ALSA)   |  |
|  | (Playwright/Chrome)|                        | (snd-aloop / PulseAudio)      |  |
|  +--------------------+                        +-------------------------------+  |
|                                                                |                  |
|                                                                | Stream Raw Audio |
|                                                                v                  |
|  +--------------------+      JSON Response     +-------------------------------+  |
|  | Deepgram API       | <--------------------- | Node.js Recording Process     |  |
|  | (Diarization Core) |                        | (FFmpeg / node-record-lpcm16) |  |
|  +--------------------+                        +-------------------------------+  |
+-----------------------------------------------------------------------------------+
```

1. **Orchestration Container:** A Linux Docker container configured with a virtual framebuffer (Xvfb) and a virtual loopback audio device.
2. **Browser Automation:** A Playwright script spins up a headless Chromium instance, injects authentication/cookies if needed, navigates to the meeting URL, interacts with DOM elements to bypass the waiting room, and enters the meeting.
3. **Audio Capture Loop:** The browser routes meeting audio out through the virtual system speaker. An internal background pipeline (via FFmpeg or native streams) catches this virtual hardware channel and saves it as an uncompressed PCM/WAV buffer or streams it raw.
4. **AI Processing Layer:** The audio data is transmitted to Deepgram with the `diarize=true` query parameter enabled. Deepgram returns timestamps, words, and unique numerical speaker IDs (e.g., `Speaker 0`, `Speaker 1`).

---

## 2. Setting Up the Docker Environment

A standard Docker container cannot capture audio out of the box because it lacks sound drivers and an X-Server for the browser interface. The `Dockerfile` below sets up PulseAudio, Xvfb, FFmpeg, and the necessary Playwright system dependencies.

### `Dockerfile`
```dockerfile
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

# Install system utilities, Xvfb, PulseAudio, and FFmpeg
RUN apt-get update && apt-get install -y     xvfb     pulseaudio     ffmpeg     alsa-utils     && rm -rf /var/lib/apt/lists/*

# Configure PulseAudio to run in a headless environment
RUN mkdir -p ~/.config/pulse &&     echo "default-server = unix:/tmp/pulse-socket" > ~/.config/pulse/client.conf

# Set up working directory
WORKDIR /app

# Copy package files and install Node.js dependencies
COPY package*.json ./
RUN npm install

# Copy application source code
COPY . .

# Environment flag to let Playwright run smoothly headlessly with extensions or audio flags
ENV DISPLAY=:99

# Copy and permissions for entrypoint shell script
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "src/bot.js"]
```

### `entrypoint.sh`
This script initializes the virtual display buffer and virtual sound server before launching the primary Node.js application process.
```bash
#!/bin/bash

# Start Xvfb (Virtual Framebuffer) on display :99
Xvfb :99 -screen 0 1280x1024x24 &
export DISPLAY=:99

# Start PulseAudio system daemon
pulseaudio --daemonize --exit-idle-time=-1 --allow-exit=false

# Create a virtual audio sink (speaker) that we can record from
pactl load-module module-null-sink sink_name=Virtual_Speaker sink_properties=device.description="Virtual_Speaker"
pactl set-default-sink Virtual_Speaker

# Load the loopback module so playback can be monitored/routed by recording utilities
pactl load-module module-loopback

# Execute the main container CMD (e.g., node src/bot.js)
exec "$@"
```

---

## 3. Playwright Browser Automation (`src/bot.js`)

The Node.js script instructs the browser to open the target link, alter permission contexts to auto-allow microphone access, bypass joining dialog checks, and enter the call layout.

```javascript
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

async function runBot(meetingUrl) {
    console.log(`[Bot] Launching browser to join: ${meetingUrl}`);

    // Launch Chromium with flags optimized for audio capture and sandbox isolation
    const browser = await chromium.launch({
        headless: false, // Must be false for Xvfb to process audio streams natively
        args: [
            '--use-fake-ui-for-media-stream',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--use-file-for-fake-audio-capture=/dev/zero', // Silences bot's own mic input
            '--allow-file-access'
        ]
    });

    // Grant browser global permissions for microphone and camera devices
    const context = await browser.newContext({
        permissions: ['microphone', 'camera'],
        viewport: { width: 1280, height: 720 }
    });

    const page = await context.newPage();

    // Route to the meeting space
    await page.goto(meetingUrl);

    // --- PLATFORM INTERACTION LOGIC (Example: Google Meet) ---
    try {
        // Wait for the name input box on the pre-join lobby screen
        const nameInputSelector = 'input[type="text"]';
        await page.waitForSelector(nameInputSelector, { timeout: 15000 });
        await page.fill(nameInputSelector, 'Archive Recording Bot');

        // Locate and click the "Ask to join" or "Join now" button
        // Note: Target selectors shift often. Use robust text matching or test setups.
        const joinButton = page.locator('button:has-text("Ask to join"), button:has-text("Join now")');
        await joinButton.waitFor({ state: 'visible' });
        await joinButton.click();
        console.log('[Bot] Clicked join button. Waiting in lobby/room...');

    } catch (err) {
        console.error('[Bot] Error automating landing interaction:', err.message);
    }

    // Start Recording the system audio pipeline
    const audioOutputPath = path.join(__dirname, '../recordings/meeting_raw.wav');
    const recorderProcess = startAudioCapture(audioOutputPath);

    // Monitor meeting lifecycle (Keep process alive until manually killed or room closes)
    // For production, look for selectors signifying 'You have been removed' or hook API calls
    process.on('SIGINT', async () => {
        console.log('[Bot] Terminating capture and cleaning environment...');
        recorderProcess.kill('SIGINT');
        await browser.close();
        process.exit();
    });
}

function startAudioCapture(outputPath) {
    console.log(`[Audio Engine] Directing output stream to: ${outputPath}`);
    
    // Ensure the output directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)){
        fs.mkdirSync(dir, { recursive: true });
    }

    // Capture the default PulseAudio monitor source via FFmpeg
    // "Virtual_Speaker.monitor" corresponds to the sink created in entrypoint.sh
    const ffmpegArgs = [
        '-f', 'pulse',
        '-i', 'Virtual_Speaker.monitor',
        '-acodec', 'pcm_s16le', // Uncompressed 16-bit Signed Integer PCM
        '-ar', '16000',         // 16kHz sampling rate is ideal for Deepgram processing
        '-ac', '1',             // Mono channel targeting single-track diarization
        '-y',                   // Overwrite file if exists
        outputPath
    ];

    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

    ffmpegProcess.stderr.on('data', (data) => {
        // Uncomment for verbose streaming diagnostics from FFmpeg engine
        // console.log(`[FFmpeg Debug] ${data}`);
    });

    ffmpegProcess.on('close', (code) => {
        console.log(`[Audio Engine] FFmpeg wrapper closed with exit code: ${code}`);
    });

    return ffmpegProcess;
}

// Retrieve URL parameter from execution arguments
const targetUrl = process.argv[2] || 'https://meet.google.com/abc-defg-hij';
runBot(targetUrl);
```

---

## 4. Transcription and Speaker Diarization (`src/transcribe.js`)

Once your meeting has concluded and FFmpeg closes out the `.wav` file, pass the data payload directly to Deepgram to identify the individual speakers and output clean transcripts.

### `src/transcribe.js`
```javascript
const { createClient } = require('@deepgram/sdk');
const fs = require('fs');
const path = require('path');

// Initialize the Deepgram SDK client using environment variable verification
const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
if (!deepgramApiKey) {
    console.error('CRITICAL: Missing DEEPGRAM_API_KEY inside system environment.');
    process.exit(1);
}
const deepgram = createClient(deepgramApiKey);

async function transcribeAndDiarize(filePath) {
    console.log(`[AI Engine] Analyzing audio matrix from: ${filePath}`);

    if (!fs.existsSync(filePath)) {
        console.error(`File path target error: ${filePath} could not be resolved.`);
        return;
    }

    try {
        const audioBuffer = fs.readFileSync(filePath);

        const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
            audioBuffer,
            {
                // Core configurations required for identifying unique speaker tags
                diarize: true,         // Tells Deepgram to isolate distinct voices
                model: 'nova-2',       // Use fastest/most accurate architectural engine
                smart_format: true,    // Fixes punctuation, capitalization, and numbers automatically
                utterances: true,      // Clusters strings by cohesive sentences
                punctuate: true
            }
        );

        if (error) {
            throw error;
        }

        processDiarizationOutput(result);

    } catch (err) {
        console.error('[AI Engine] Exception occurred while executing transcription pipeline:', err);
    }
}

function processDiarizationOutput(apiResult) {
    console.log('
--- Meeting Transcript Processing Engine --- 
');

    // Access utterance mappings constructed via the Deepgram layout
    const utterances = apiResult.results?.channels[0]?.alternatives[0]?.utterances;

    if (!utterances || utterances.length === 0) {
        console.warn('Analysis completed but no speaker utterances were extracted.');
        return;
    }

    // Track structured block output
    const operationalLog = [];

    utterances.forEach((utterance) => {
        const speakerId = utterance.speaker;
        const textStr = utterance.transcript;
        const startTime = utterance.start;

        // Convert decimal timeline seconds into clean MM:SS format
        const timestampStr = formatTimestamp(startTime);

        const absoluteRow = `[${timestampStr}] Speaker ${speakerId}: "${textStr}"`;
        console.log(absoluteRow);
        operationalLog.push(absoluteRow);
    });

    // Save final structured transcript artifact
    const logDestination = path.join(__dirname, '../recordings/formatted_transcript.txt');
    fs.writeFileSync(logDestination, operationalLog.join('
'), 'utf-8');
    console.log(`
[System] Complete diarized text log successfully archived to: ${logDestination}`);
}

function formatTimestamp(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Target execution relative to the generated raw recording path
const audioPathTarget = path.join(__dirname, '../recordings/meeting_raw.wav');
transcribeAndDiarize(audioPathTarget);
```

---

## 5. Execution and Verification Pipeline

To spin up the infrastructure on your computer or remote Linux server, deploy using the commands outlined below.

### Setup Step 1: Initialize Manifest Files
Create a local folder with your code files and run standard package installations.

```bash
# Initialize project directory tree
mkdir custom-meeting-bot && cd custom-meeting-bot
mkdir src recordings

# Generate project runtime requirements
cat <<EOT > package.json
{
  "name": "custom-meeting-bot",
  "version": "1.0.0",
  "description": "Headless self-hosted audio extraction bot via Playwright and Deepgram",
  "main": "src/bot.js",
  "dependencies": {
    "@deepgram/sdk": "^3.5.0",
    "playwright": "^1.44.0"
  }
}
EOT

npm install
```

### Setup Step 2: Build and Build Container Framework
Build the system dependencies image via Docker:

```bash
docker build -t meeting-bot:v1 .
```

### Setup Step 3: Spin Up and Execute the Bot
Run the container environment, pass through your target meeting URL, and map a host volume so the generated `.wav` raw output records straight back to your hardware filesystem directory:

```bash
docker run -it --rm   -v "$(pwd)/recordings:/app/recordings"   meeting-bot:v1   node src/bot.js "https://meet.google.com/your-meeting-id"
```

*When you are ready to stop recording or the meeting concludes, hit `Ctrl + C` in your console window. The container runtime environment signals FFmpeg to cleanly finalize your `meeting_raw.wav` file.*

### Setup Step 4: Run the Diarization Pipeline
Execute your Deepgram script locally or pass it within the container setup to process your transcript file output using your developer access tokens:

```bash
export DEEPGRAM_API_KEY="your_api_key_here"
node src/transcribe.js
```

### Expected Output Example (`formatted_transcript.txt`)
```text
[00:04] Speaker 0: "Hello everyone, thanks for joining the system architecture synchronization meeting."
[00:12] Speaker 1: "Thanks John, I want to clarify if we are hosting the Docker layers inside an AWS EC2 instance or running them containerized via ECS?"
[00:23] Speaker 0: "We are starting with a standalone Docker system on an EC2 instance to preserve absolute filesystem control over the loopback audio adapters."
```

---

## 6. Critical Operational Challenges & Tips

1. **DOM Selectors Break Regularly:** Services like Zoom and Google Meet constantly refactor their landing and waiting room pages. If your bot hangs at a stage or fails to click "Join", launch Playwright with a standard browser headlessly on a desktop development environment first to identify changed layout IDs.
2. **Handling Waiting Rooms:** If a host must let the bot into the meeting, the Playwright process must wait patiently. You can add timeout loops or logic (`page.waitForSelector()`) targeted to watch when the internal call container grid finally renders.
3. **Echo and Loopback Isolation:** Setting the browser option `--use-file-for-fake-audio-capture=/dev/zero` tells the meeting that the bot's own mic is sending complete silence. This is critical to prevent acoustic feedback loops where the meeting audio feeds directly back into its own microphone track.