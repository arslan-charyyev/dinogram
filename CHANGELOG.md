# Changelog

## [4.0.0] - 2026-10-02

[4.0.0]: https://github.com/arslan-charyyev/dinogram/compare/v3.2.1...v4.0.0

### Added

- The command menu of an admin shows the admin commands: `/allow`, `/deny`,
  `/allowed` and `/settings`. The menu of everybody else does not show them.

### Changed

- The deploy workflow reads `BOT_ADMINS` and `REPORT_ERRORS_TO` from repository
  secrets instead of repository variables, so the workflow logs mask them. Move
  the two values to secrets before the next deploy.
- An admin chat in `BOT_ADMINS` now runs `/allow`, `/deny` and `/allowed`, the
  same way as `/settings`. Before, only an admin user ran them.

### Removed

- The `WHITELIST` setting. The bot ignores it, and `BOT_ADMINS` is the only
  access setting in the config. Before you upgrade, add the IDs of `WHITELIST`
  with `/allow`. A bot that sets `WHITELIST` and leaves `BOT_ADMINS` empty now
  serves everyone.

## [3.2.1] - 2026-09-30

[3.2.1]: https://github.com/arslan-charyyev/dinogram/compare/v3.2.0...v3.2.1

### Fixed

- A TikTok video in inline mode downloads again. Since 3.2.0, the chosen result
  downloaded the video without the cookies of the post, so TikTok refused it
  with "Download URL not OK".

## [3.2.0] - 2026-09-30

[3.2.0]: https://github.com/arslan-charyyev/dinogram/compare/v3.1.3...v3.2.0

### Added

- In inline mode, a post with several items now shows one result for each item,
  so you choose the item that goes out. Before, only the first item went out.
- An inline item from such a post has a `📥 Get all` button, which opens the
  private chat with the bot, and the bot sends the whole post there

## [3.1.3] - 2026-09-29

[3.1.3]: https://github.com/arslan-charyyev/dinogram/compare/v3.1.2...v3.1.3

### Fixed

- A subscription now waits for a live stream or a premiere to end, and then
  sends the video. Before, each check of an ongoing stream cost one of the eight
  tries, so a stream of more than two hours ended as a link instead of a video.

## [3.1.2] - 2026-09-29

[3.1.2]: https://github.com/arslan-charyyev/dinogram/compare/v3.1.1...v3.1.2

### Fixed

- A Pinterest video that the API lists only as an HLS stream now gets its MP4
  from the pin query of the Pinterest web app, and then from the known names of
  the file next to the stream. Before, the bot searched the page of the pin,
  which Pinterest sends without the video to some servers.

## [3.1.1] - 2026-09-28

[3.1.1]: https://github.com/arslan-charyyev/dinogram/compare/v3.1.0...v3.1.1

### Fixed

- TikTok photo posts download again, with their caption and music. The bot reads
  them from the video page of the same post, which needs no signed request.
- A TikTok post with more than ten images no longer stops halfway, because the
  image downloads no longer share one HTTP/2 connection that TikTok breaks
- A download that breaks during an upload now gets an error reply. Before, the
  bot retried the upload forever and never answered.
- A post whose music fails now reports the failure, and a missing music file no
  longer goes out as a broken audio

## [3.1.0] - 2026-09-25

[3.1.0]: https://github.com/arslan-charyyev/dinogram/compare/v3.0.0...v3.1.0

### Added

- YouTube channel subscriptions in private chats: `/subscribe` or a channel link
  opens a menu that asks for the format (high, medium, low, or audio), the
  frequency (as soon as posted, once a day, or once a week), and the Shorts, and
  `/subscriptions` manages them
- New config options: `SUBSCRIPTIONS_ENABLED`, `SUBSCRIPTION_CHECK_MINUTES`

## [3.0.0] - 2026-09-25

[3.0.0]: https://github.com/arslan-charyyev/dinogram/compare/v2.0.1...v3.0.0

### Added

- Pinterest pins with an image, a GIF, a video, several pages, or a carousel,
  with no login, including `pin.it` short links
- A pin of a YouTube video goes to the YouTube menu; a pin of a video from any
  other site gets a reply with its link
- New config option `PINTEREST_ENABLED`

### Changed

- A single GIF goes out as an animation, so that it plays

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
