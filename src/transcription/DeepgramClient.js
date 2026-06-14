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
