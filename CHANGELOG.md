# Changelog

## [2.0.1] - 2026-09-25

[2.0.1]: https://github.com/arslan-charyyev/dinogram/compare/v2.0.0...v2.0.1

### Fixed

- A YouTube sign-in wall now reports its real reason, and tells an admin to set
  a YouTube cookie. Before, the bot reported only "Requested format is not
  available".
- After a sign-in wall, the bot tries the YouTube cookie first for 30 minutes,
  instead of trying the blocked ways first on every request

## [2.0.0] - 2026-09-25

[2.0.0]: https://github.com/arslan-charyyev/dinogram/compare/v1.3.1...v2.0.0

### Changed

- **Breaking:** the Bot API server must run in `--local` mode
  (`TELEGRAM_LOCAL=1`) and mount the downloads volume of the bot at
  `/app/downloads`, because the bot sends YouTube files to it by their path
  (`UPLOAD_BY_PATH`)
- **Breaking:** the bot needs 1 GB of memory, because yt-dlp starts Deno to
  solve the challenges of YouTube
- The Docker image includes yt-dlp and ffmpeg
- grammY and its plugins come from npm, and support Bot API 10.3
- The settings buttons check that the user is an admin

### Added

- YouTube videos and audio, in the quality that the user chooses
- A private quality picker in groups, which only the member who presses sees
- One inline result for each YouTube quality
- YouTube Shorts, which come at once, with no menu
- A YouTube cookie in the settings, for a server that YouTube blocks
- New config options: `YOUTUBE_ENABLED`, `YOUTUBE_MAX_VIDEO_MINUTES`,
  `YOUTUBE_MAX_AUDIO_MINUTES`, `YT_DLP_PATH`, `DOWNLOAD_DIR`, `UPLOAD_BY_PATH`,
  `UPLOAD_LIMIT_MB`

## [1.3.1] - 2026-09-20

[1.3.1]: https://github.com/arslan-charyyev/dinogram/compare/v1.3.0...v1.3.1

### Fixed

- Instagram downloads, which stopped working when Instagram renamed the media
  payload in the page

### Changed

- A TikTok photo post now reports why it fails, because TikTok no longer serves
  those images to the bot

## [1.3.0] - 2026-09-20

[1.3.0]: https://github.com/arslan-charyyev/dinogram/compare/v1.2.5...v1.3.0

### Added

- Inline mode, so the bot can be tagged in any chat, including a private chat
  with another person
- Admin-managed whitelist with the `/allow`, `/deny` and `/allowed` commands

### Changed

- Deployment now targets Coolify instead of the remote Docker host
- A deployment that sets `BOT_ADMINS` and leaves `WHITELIST` empty now serves
  the admins only

## [1.2.5] - 2025-08-04

[1.2.5]: https://github.com/arslan-charyyev/dinogram/compare/v1.2.4...v1.2.5

### Added

- Processing message, when bot starts processing a supported link

### Fixed

- TikTok downloads

### Changed

- Slightly improved error messages

## [1.2.4] - 2025-05-27

[1.2.4]: https://github.com/arslan-charyyev/dinogram/compare/v1.2.3...v1.2.4

### Added

- New config option `TIKTOK_ENABLED`
- New config option `INSTAGRAM_ENABLED`

## [1.2.3] - 2025-05-25

[1.2.3]: https://github.com/arslan-charyyev/dinogram/compare/v1.2.2...v1.2.3

### Changed

- Retry errors now show cause error
