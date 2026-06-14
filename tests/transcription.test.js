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
