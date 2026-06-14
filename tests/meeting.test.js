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
