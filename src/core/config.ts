import * as dotenv from "@std/dotenv";
import { isLogLevel, LogLevel } from "@logtape/logtape";
import { z } from "zod";

const bool = z.enum(["true", "false"]).transform((value) => value === "true");

const intCsv = z
  .string()
  .transform((it) => it.split(",").filter(Boolean).map(Number))
  .pipe(z.array(z.number().int()));

const Config = z.object({
  BOT_ADMINS: intCsv
    .default("")
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

  INSTAGRAM_ENABLED: bool
    .default("true")
    .describe("Enables support for downloading Instagram media"),

  LOG_LEVEL: z
    .custom<LogLevel>(isLogLevel, {
      message: "Invalid log level. See: https://logtape.org/manual/levels",
    })
    .default("debug")
    .describe("Log level. Source: https://jsr.io/@std/log/0.224.7/levels.ts"),

  REPORT_ERRORS_TO: intCsv
    .default("")
    .describe(
      "A comma-separated list of user or chat IDs that will receive notifications about any errors",
    ),

  SEND_AS_REPLY: bool
    .default("true")
    .describe("Send media as a reply or as a regular message"),

  SEND_ERRORS: bool
    .default("true")
    .describe("Send errors to the corresponding chat"),

  SHOW_CAPTION_ABOVE_MEDIA: bool
    .default("false")
    .describe("Send caption above media (true), or below (false)"),

  TEST_INSTAGRAM_COOKIE: z
    .string()
    .default("")
    .describe("Instagram cookies to be used for testing"),

  TIKTOK_ENABLED: bool
    .default("true")
    .describe("Enables support for downloading TikTok media"),

  WHITELIST: intCsv
    .default("")
    .describe(
      "A comma-separated list of user or chat IDs that are allowed to make requests. " +
        "If empty, then no restrictions apply.",
    ),

  WITH_CAPTION: bool
    .default("true")
    .describe("Send media with title/description as caption"),
});

const env = {
  ...Deno.env.toObject(),
  ...dotenv.loadSync(),
};

export const config = Config.parse(env);
