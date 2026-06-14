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
      const proc = this.process;
      this.process = null;
      proc.on('close', () => {
        logger.info('Recording stopped');
        resolve();
      });
      // SIGINT causes FFmpeg to finalize the WAV header cleanly before exit
      proc.kill('SIGINT');
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
