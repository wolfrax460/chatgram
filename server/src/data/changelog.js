/**
 * Curated changelog entries for web/desktop-only releases that do not have an
 * AppRelease row. GET /api/app/changelog merges these with the published
 * AppRelease rows (newest first).
 *
 * Shape: { version, platform, releasedAt, notes, url? }.
 */
module.exports = [
  {
    version: 'web-2026.10.29',
    platform: 'web',
    releasedAt: '2026-10-29T06:00:00.000Z',
    notes: 'Report automation: Help reports now create GitHub issues and can be triaged from Telegram.',
    url: '/docs/',
  },
  {
    version: 'web-2026.10.29',
    platform: 'web',
    releasedAt: '2026-10-29T05:30:00.000Z',
    notes: 'Protected account deletion: confirm with your password and an emailed code, with a 14-day grace period to cancel.',
    url: '/docs/',
  },
  {
    version: 'web-2026.10.29',
    platform: 'web',
    releasedAt: '2026-10-29T05:00:00.000Z',
    notes: 'Settings rebuilt with a WhatsApp-style list and dedicated pages.',
    url: '/docs/',
  },
  {
    version: 'windows-1.1.5',
    platform: 'windows',
    releasedAt: '2026-10-28T18:00:00.000Z',
    notes: 'Screen-share quality improved with better bitrate adaptation.',
  },
  {
    version: 'windows-1.1.5',
    platform: 'windows',
    releasedAt: '2026-10-28T17:30:00.000Z',
    notes: 'Remote control: request control of a shared screen from the desktop app.',
  },
  {
    version: 'web-2026.10.28',
    platform: 'web',
    releasedAt: '2026-10-28T16:00:00.000Z',
    notes: 'Replies: reply cards, quoted replies and reply previews in the composer.',
    url: '/docs/',
  },
  {
    version: 'android-1.1.3',
    platform: 'android',
    releasedAt: '2026-10-28T12:00:00.000Z',
    notes: 'Voice notes with WhatsApp-style slide-to-cancel, lock-to-record, pause, waveform and playback speed.',
  },
  {
    version: 'web-2026.10.27',
    platform: 'web',
    releasedAt: '2026-10-27T20:00:00.000Z',
    notes: 'Chat wallpapers: pick a wallpaper per chat or for the whole app.',
    url: '/docs/',
  },
];
