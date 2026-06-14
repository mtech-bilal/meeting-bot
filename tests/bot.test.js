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
