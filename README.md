# 🦕 Dinogram 📨

[![Common Changelog](https://common-changelog.org/badge.svg)](https://common-changelog.org)

<p align="center"><img src="./assets/img/logo.jpg" height=200/></p>

**Dinogram** is a Telegram bot that can download public videos & photos from
social media platforms (TikTok & Instagram) and send them to a Telegram chat. To
use it, add the bot to a group, send it a direct message with a link to a post,
or tag it in any chat (see `Inline mode`), and it will respond with the
corresponding media items.

🎁 Checkout the demo Bot instance: https://t.me/dinogram_bot

https://github.com/user-attachments/assets/7d3e5f91-f126-4fa7-b232-2cc41d3d1f21

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
  - Posts that are private or require sign-in are supported if authentication
    cookie is provided.
  - Instagram has severe rate limits for non-authenticated users: 200 requests
    per hour. Therefore, frequent errors caused by rate limits are to be
    expected.

Extra bot features:

> [!NOTE]
> ⚙️ denotes config keys (environment variables)
>
> 🗨️ denotes bot settings (`/settings` command in chat)

- Use authentication cookies provided in chat (🗨️) by pre-defined admin (⚙️:
  `BOT_ADMINS`)
- Automatically resend messages when hitting
  [flood control limits](https://grammy.dev/advanced/flood).
- Truncates long captions to avoid hitting the
  [max character count limit](https://limits.tginfo.me/en).
- Configurable reply behavior (⚙️:
  `WITH_CAPTION`,`SEND_AS_REPLY`,`SHOW_CAPTION_ABOVE_MEDIA`).
- Tag the bot in any chat, including a private chat with another person (⚙️:
  `INLINE_ENABLED`, `INLINE_STORAGE_CHAT`). See `Inline mode`.
- Restrict bot access by user ID or chat ID, from the config (⚙️`WHITELIST`) or
  with a chat command (`/allow`). See `Access control`.
- Report errors to original chat (⚙️`SEND_ERRORS`) or pre-configured
  recipients(⚙️ `REPORT_ERRORS_TO`).
- Configurable
  [Bot API server](https://core.telegram.org/bots/api#using-a-local-bot-api-server)
  URL (⚙️ `BOT_API_ROOT`). It can be used to increase max file size limit.

> [!TIP]
> You can use `@raw_data_bot` to get the user or chat ID

## 🏷️ Inline mode

Inline mode lets you tag the bot in any chat, even in a private chat with
another person, where the bot is not a member. Type `@your_bot` followed by a
link in the message field, wait for the result card, then tap it. Your own
account sends a placeholder message, and the bot replaces that message with the
downloaded media.

Telegram keeps inline mode off by default. Therefore the owner of the bot must
change two settings in the [BotFather](https://telegram.me/BotFather):

- `/setinline` — enable inline mode, and give a placeholder text, for example
  `Paste a link…`
- `/setinlinefeedback` — set the probability to `Enabled` (100%), because the
  bot starts the download only after Telegram reports the chosen result.

An inline message cannot carry a fresh upload. Thus the bot first sends the
media to a storage chat, and then shows the resulting file in the inline
message. The bot deletes the storage message immediately after the upload,
because the file stays available through its ID. When `INLINE_STORAGE_CHAT` is
`0` (the default), the bot uses the private chat of the user who made the
request. That user must start the bot first, or the upload fails.

> [!NOTE]
> An inline message holds one media item. For a post with more items, the bot
> sends the first item, and shows the total count in the caption.

## 🔐 Access control

The bot serves everyone while `BOT_ADMINS` and `WHITELIST` are both empty. As
soon as one of them names somebody, the gate closes: an admin always passes, and
everybody else needs an entry.

Two lists feed that gate:

- ⚙️ `WHITELIST` — the static list of the deployment. It changes only with a
  redeploy.
- The dynamic list — an admin changes it in chat, and the change survives a
  restart, because the list lives in the database of the bot (⚙️ `DATA_DIR`).

One entry holds one ID. A user ID admits that person in every chat. A chat ID
admits every member of that chat, which is how a whole group gets access.

| Command    | Description                             |
| ---------- | --------------------------------------- |
| `/allow`   | Adds an entry to the dynamic list.      |
| `/deny`    | Removes an entry from the dynamic list. |
| `/allowed` | Lists the admins and both lists.        |

Only an admin (⚙️ `BOT_ADMINS`) runs these commands. `/allow` and `/deny` find
their target in three ways:

- With arguments, they act on each ID: `/allow 12345 -1009876`
- In a reply, they act on the author of the message that you reply to.
- With neither, they act on the current chat. Thus an admin opens a whole group
  with one `/allow` inside it.

A refused user gets an answer that names their user ID and the chat ID, which is
what they send to an admin to ask for access.

> [!NOTE]
> A deployment that sets `BOT_ADMINS` and leaves `WHITELIST` empty served
> everyone before this change. It now serves the admins only, until an `/allow`
> names somebody.

## 🔮 Future plans:

- TikTok Authentication (to access posts that require sign-in)
- Automated authentication
- Youtube videos
- Rate limiter (to give everyone a fair chance)

## 🚀 Deployment

Regardless of the deployment method, you need to obtain a token from the
[BotFather](https://telegram.me/BotFather).

### Coolify

The public instance runs on [Coolify](https://coolify.io). A push of a version
tag runs [publish-release.yml](.github/workflows/publish-release.yml), which
builds the image, pushes it to GHCR, and then calls
[deploy-to-coolify.yml](.github/workflows/deploy-to-coolify.yml).

That workflow runs [coolify_deploy.py](.github/scripts/coolify_deploy.py), which
holds the whole Coolify config of the app — image, resource limits, and every
environment variable — in its `SPEC` and `ENVS` tables. Edit them, push a tag,
and CI reconciles the app: the first run creates the project and the
application, and every later run PATCHes them. It also creates the persistent
volume at `/app/data` once, which is where the settings and the whitelist live.

A manual run of the workflow covers the two cases that a tag push does not. With
no version, it redeploys `latest`, which is how a rotated token reaches the
container, because every run re-syncs the whole environment. With a version, it
redeploys that release, which is the rollback path.

Repository secrets: `COOLIFY_TOKEN`, `BOT_TOKEN`. Repository variables:
`COOLIFY_URL`, `BOT_ADMINS`, `WHITELIST`, `REPORT_ERRORS_TO`. The Telegram IDs
stay in variables, because this repository is public.

> [!NOTE]
> The bot talks to a
> [local Bot API server](https://core.telegram.org/bots/api#using-a-local-bot-api-server)
> at `http://telegram-bot-api:8081`, which raises the upload limit from 50 MB to
> 2 GB. That container runs beside Coolify, not inside it, so the application
> needs its **Connect to Predefined Network** option on. Without that option
> Coolify isolates the container, the name does not resolve, and every upload
> fails.

### Docker

One-liner with default configuration:

```sh
docker run ghcr.io/arslan-charyyev/dinogram:latest -e BOT_TOKEN=your:token
```

### Docker Compose

You may refer to [compose.prod.yml](./compose.prod.yml) for an example of
production deployment using docker compose.

> [!NOTE]
> Dinogram stores its runtime settings in a sqlite database file. By default the
> database file is created in deno's cache folder, which you can find by using
> the following command: `deno info | grep storage`. This folder can be changed
> using the `DATA_DIR` environment variable.
>
> The docker image uses the `DATA_DIR` variable to set this directory to
> `/app/data/`. To persist the data across container ups & downs, the
> `compose.prod.yml` file maps this directory to a docker volume.

## ⚙️ Config

There are 2 ways to configure the bot:

- via environment variables (during deployment)
- via bot settings (during operation)

### Environment variables

The only required config variable is the `BOT_TOKEN`. You can set either via a
`.env` file or via environment variables.

For the other config options and their descriptions, please refer to the
[config.ts](src/core/config.ts) file.

### Bot settings

These settings can be configured by sending the `/settings` command to the bot,
and changing them interactively.

https://github.com/user-attachments/assets/998c57d7-6550-439b-a23b-ae312e280d1b

## 🛠️ Development setup

### System requirements

- Linux / WSL<sup>(unverified)</sup>
- [Deno](https://deno.com/) v2.x (See [Dockerfile](./Dockerfile))
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
deno task deps:cache # Download all dependencies
```

```sh
deno task main
```

```sh
deno task issues:check # Check project issues
```

```sh
deno task test # Run all tests
```

The following builds the Dinogram docker image and starts corresponding
container, alongside Bot API server.

```sh
devbox run docker
```

### Dependency considerations

Most libraries are fetched from `jsr` or `npm`. However, there are some
exceptions:

- `grammy` libraries are sourced from deno-land because sourcing them from npm
  breaks their typings. Additionally, it is pinned to version `1.30.0` at the
  moment, since its plugins have not been updated to make use of latest version.

## 🙏🏻 Acknowledgements

- [TeleTok](https://github.com/captaincolonelfox/TeleTok) - inspiration for the
  TikTok video downloader.
- [SignTok](https://github.com/pablouser1/SignTok) - TikTok URL signing method.

## ⚖️ License

[MIT](./LICENSE) (c) 2024 Arslan Charyyev
