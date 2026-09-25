import * as dotenv from "@std/dotenv";
import { LogLevelNames } from "@std/log";
import { z } from "zod";

// Source: https://github.com/colinhacks/zod/discussions/2125#discussioncomment-8264873
const zodEnum = <T>(arr: T[]): [T, ...T[]] => arr as [T, ...T[]];

const bool = z.enum(["true", "false"]).transform((value) => value === "true");

const intCsv = z
  .string()
  .transform((it) => it.split(",").filter(Boolean).map(Number))
  .pipe(z.array(z.number().int()));

const Config = z.object({
  BOT_ADMINS: intCsv
    .default([])
    .describe(
      "A comma-separated list of user or chat IDs that can change bot settings",
    ),

  BOT_API_ROOT: z
    .string()
    .default("")
    .describe(
      "A URL to a self-hosted Telegram Bot API server instance. " +
        "Read more: https://grammy.dev/guide/api#running-a-local-bot-api-server",
    ),

  BOT_TOKEN: z
    .string()
    .describe(
      "A required bot token, which can be obtained from the https://t.me/BotFather",
    ),

  DATA_DIR: z
    .string()
    .default("")
    .describe(
      "A path to directory for storing app data, such as database files",
    ),

  DOWNLOAD_DIR: z
    .string()
    .default("")
    .describe(
      "A path to directory for temporary downloads, such as YouTube videos. " +
        "When empty, the temp directory of the system is used. " +
        "With UPLOAD_BY_PATH, the Bot API server must see it at the same path.",
    ),

  INLINE_ENABLED: bool
    .default(true)
    .describe(
      "Enables inline mode, so that the bot can be tagged (@bot <link>) in " +
        "any chat, including a private chat that the bot is not a member of. " +
        "Inline mode and inline feedback must also be enabled in the BotFather.",
    ),

  INLINE_STORAGE_CHAT: z.coerce
    .number()
    .int()
    .default(0)
    .describe(
      "A user or chat ID that inline media is uploaded to before it is " +
        "shared, because an inline message cannot carry a fresh upload. " +
        "When 0, the private chat of the requesting user is used instead.",
    ),

  INSTAGRAM_ENABLED: bool
    .default(true)
    .describe("Enables support for downloading Instagram media"),

  LOG_LEVEL: z
    .enum(zodEnum(LogLevelNames))
    .default("DEBUG")
    .describe("Log level. Source: https://jsr.io/@std/log/0.224.7/levels.ts"),

  PINTEREST_ENABLED: bool
    .default(true)
    .describe("Enables support for downloading Pinterest pins"),

  REPORT_ERRORS_TO: intCsv
    .default([])
    .describe(
      "A comma-separated list of user or chat IDs that will receive notifications about any errors",
    ),

  SEND_AS_REPLY: bool
    .default(true)
    .describe("Send media as a reply or as a regular message"),

  SEND_ERRORS: bool
    .default(true)
    .describe("Send errors to the corresponding chat"),

  SHOW_CAPTION_ABOVE_MEDIA: bool
    .default(false)
    .describe("Send caption above media (true), or below (false)"),

  SUBSCRIPTION_CHECK_MINUTES: z.coerce
    .number()
    .int()
    .min(5)
    .default(15)
    .describe(
      "How often, in minutes, the bot checks the subscribed YouTube channels " +
        "for new videos",
    ),

  SUBSCRIPTIONS_ENABLED: bool
    .default(true)
    .describe(
      "Enables YouTube channel subscriptions in private chats. Needs " +
        "YOUTUBE_ENABLED.",
    ),

  TEST_INSTAGRAM_COOKIE: z
    .string()
    .default("")
    .describe("Instagram cookies to be used for testing"),

  TIKTOK_ENABLED: bool
    .default(true)
    .describe("Enables support for downloading TikTok media"),

  UPLOAD_BY_PATH: bool
    .default(false)
    .describe(
      "Send downloaded files to the Bot API server by their path, so that the " +
        "bytes never pass through the bot. Needs a local Bot API server in " +
        "--local mode (TELEGRAM_LOCAL=1), which sees DOWNLOAD_DIR at the same path.",
    ),

  UPLOAD_LIMIT_MB: z.coerce
    .number()
    .int()
    .min(0)
    .default(0)
    .describe(
      "The largest file in MB that the bot uploads. When 0, the limit is " +
        "just under 2000 with BOT_API_ROOT (a local Bot API server), and just " +
        "under 50 without it.",
    ),

  WHITELIST: intCsv
    .default([])
    .describe(
      "A comma-separated list of user or chat IDs that are allowed to make requests. " +
        "If empty, then no restrictions apply.",
    ),

  WITH_CAPTION: bool
    .default(true)
    .describe("Send media with title/description as caption"),

  YOUTUBE_ENABLED: bool
    .default(true)
    .describe("Enables support for downloading YouTube videos and audio"),

  YOUTUBE_MAX_AUDIO_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .default(180)
    .describe(
      "The longest YouTube video, in minutes, that the bot downloads as audio",
    ),

  YOUTUBE_MAX_VIDEO_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .default(120)
    .describe(
      "The longest YouTube video, in minutes, that the bot downloads as video",
    ),

  YT_DLP_PATH: z
    .string()
    .default("yt-dlp")
    .describe("A path to the yt-dlp binary, which downloads YouTube media"),
});

const env = {
  ...Deno.env.toObject(),
  ...dotenv.loadSync(),
};

export const config = Config.parse(env);

/**
 * A local Bot API server accepts uploads up to 2000 MB, and the hosted one up
 * to 50 MB. A small margin keeps the container overhead of a merge in bounds.
 */
export const uploadLimitBytes =
  (config.UPLOAD_LIMIT_MB || (config.BOT_API_ROOT ? 1950 : 49)) * 1024 * 1024;
