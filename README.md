# 🦕 Dinogram 📨

<div style="text-align:center"><img src="./assets/img/logo.jpg" height=200/></div>

**Dinogram** is a Telegram bot that can download public videos and photos from
TikTok and Instagram and send them to Telegram. Add it to a group or send it a
direct message with a link to a post and it will respond with the corresponding
media items.

🎁 Checkout the demo Bot instance: https://t.me/dinogram_bot

> [!NOTE]
> This public instance is for demonstration purposes only. Therefore, it might
> frequently run into rate limits of social media platforms, or into usage
> quotas set by cloud VM provider. For optimal results, it is recommended to
> self-host the bot. To learn more, refer to the `Deployment` section of this
> document.

Supported social media platforms:

- TikTok
  - Videos with captions are supported.
  - Photos with title, captions, and music are supported.
  - Posts that are private or require sign-in are NOT supported.
- Instagram
  - Reels and posts with mixed content (photos & videos) are supported.
  - Posts that are private or require sign-in are NOT supported.
  - Instagram has severe rate limits for non-authenticated users: 200 requests
    per hour. Therefore, frequent errors caused by rate limits are to be
    expected.

Extra bot features:

> [!NOTE]
> ⚙️ denotes config keys

- Automatically resend messages when hitting
  [flood control limits](https://grammy.dev/advanced/flood).
- Truncates long captions to avoid hitting the
  [max character count limit](https://limits.tginfo.me/en).
- Configurable reply behavior (⚙️:
  `WITH_CAPTION`,`SEND_AS_REPLY`,`SHOW_CAPTION_ABOVE_MEDIA`).
- Report errors to original chat (⚙️`SEND_ERRORS`) or pre-configured
  recipients(⚙️ `REPORT_ERRORS_TO`).
- Configurable
  [Bot API server](https://core.telegram.org/bots/api#using-a-local-bot-api-server)
  URL (⚙️ `BOT_API_ROOT`). It can be used to increase max file size limit.

## 🔮 Future plans:

- Authentication (to access posts that require sign-in)
- Youtube videos
- Rate limiter (to give everyone a fair chance)

## 🚀 Deployment

Regardless of the deployment method, you need to obtain a token from the
[BotFather](https://telegram.me/BotFather).

### Docker

One-liner with default configuration:

```sh
docker run ghcr.io/arslan-charyyev/dinogram:latest -e BOT_TOKEN=your:token
```

### Docker Compose

You may refer to [compose.prod.yml](./compose.prod.yml) for an example of
production deployment using docker compose.

## ⚙️ Config

The only required config variable is the `BOT_TOKEN`. You can set either via a
`.env` file or via environment variables.

For the other config options and their descriptions, please refer to the
[config.ts](src/core/config.ts) file.

## 🛠️ Development setup

### System requirements

- Linux / WSL<sup>(unverified)</sup>
- [Devbox](https://www.jetify.com/devbox/docs/quickstart/)
- [VS Code](https://code.visualstudio.com/)

Steps:

- Clone this repository and open it in VS Code.
- Initialize environment variables:
  ```sh
  cp .template.env .env
  ```
- Update `BOT_TOKEN` variable in the [.env](.env) file with your bot token.
- Run the project using the `main` configuration in VS Code.

### Useful commands

```sh
deno cache deps.ts # Download all dependencies
```

```sh
deno task check-issues # Check project issues
```

```sh
deno test -A # Run all tests
```

Build Dinogram docker image and start corresponding container, alongside Bot API
server.

```sh
devbox run docker
```

### Dependency considerations

Unfortunately, Deno 2 breaks the `JSDOM` dependency, for which I have not been
able to find a suitable replacement. Hence, the project has to stay on v1 until
a fix or a workaround is available for v2.

Most libraries are fetched from `jsr` or `npm`. However, there are some
exceptions:

- `jsdom` is sourced from esm.sh because sourcing it from npm doesn't fetch its
  peer dependency `canvas`.
- `grammy` libraries are sourced from deno-land because sourcing them from npm
  breaks their typings.

## 🙏🏻 Acknowledgements

- [TeleTok](https://github.com/captaincolonelfox/TeleTok) - inspiration for the
  TikTok video downloader.
- [SignTok](https://github.com/pablouser1/SignTok) - TikTok URL signing method.

## ⚖️ License

[MIT](./LICENSE) (c) 2024 Arslan Charyyev
