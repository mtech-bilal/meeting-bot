describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
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

  it('falls back to default when numeric env var is not a valid number', () => {
    process.env.DEEPGRAM_API_KEY = 'test-key';
    process.env.ADMISSION_TIMEOUT_MS = 'not-a-number';

    const config = require('../src/config');
    expect(config.admissionTimeoutMs).toBe(120000);
    expect(Number.isFinite(config.admissionTimeoutMs)).toBe(true);
  });
});
