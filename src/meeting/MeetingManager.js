const GoogleMeetAdapter = require('./adapters/GoogleMeetAdapter');

// Add new platform adapters here — no other files need to change
const PLATFORM_PATTERNS = [
  { pattern: /meet\.google\.com/, Adapter: GoogleMeetAdapter, name: 'Google Meet' },
  // { pattern: /zoom\.us/, Adapter: ZoomAdapter, name: 'Zoom' },
  // { pattern: /teams\.microsoft\.com/, Adapter: TeamsAdapter, name: 'Microsoft Teams' },
];

class MeetingManager {
  constructor(page, meetingUrl) {
    this.page = page;
    this.meetingUrl = meetingUrl;
    this.adapter = this._detectAdapter();
  }

  _detectAdapter() {
    const match = PLATFORM_PATTERNS.find(({ pattern }) => pattern.test(this.meetingUrl));
    if (!match) {
      throw new Error(`Unsupported meeting platform for URL: ${this.meetingUrl}`);
    }
    return new match.Adapter(this.page);
  }

  async join() { return this.adapter.join(this.meetingUrl); }
  async waitForAdmission() { return this.adapter.waitForAdmission(); }
  async detectEnd() { return this.adapter.detectEnd(); }
  async leave() { return this.adapter.leave(); }
}

module.exports = MeetingManager;
