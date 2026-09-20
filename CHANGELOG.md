# Changelog

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
