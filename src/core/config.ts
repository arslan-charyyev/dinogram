import * as dotenv from "@std/dotenv";
import { LogLevelNames } from "@std/log";
import { z } from "zod";

// Source: https://github.com/colinhacks/zod/discussions/2125#discussioncomment-8264873
const zodEnum = <T>(arr: T[]): [T, ...T[]] => arr as [T, ...T[]];

const bool = z.enum(["true", "false"])
  .transform((value) => value === "true");

const csv = z.string()
  .transform((it) => it.split(",").filter((it) => it))
  .pipe(z.array(z.string()));

const intCsv = z.string()
  .transform((it) => it.split(",").filter(Boolean).map(Number))
  .pipe(z.array(z.number().int()));

const Config = z.object({
  BOT_TOKEN: z.string().describe(
    "A required bot token, which can be obtained from the https://t.me/BotFather",
  ),
  LOG_LEVEL: z.enum(zodEnum(LogLevelNames)).default("DEBUG").describe(
    "Log level. Source: https://jsr.io/@std/log/0.224.7/levels.ts",
  ),
  WITH_CAPTION: bool.default("true").describe(
    "Send media with title/description as caption",
  ),
  SEND_AS_REPLY: bool.default("true").describe(
    "Send media as a reply or as a regular message",
  ),
  SEND_ERRORS: bool.default("true").describe(
    "Send errors to the corresponding chat",
  ),
  SHOW_CAPTION_ABOVE_MEDIA: bool.default("false").describe(
    "Send caption above media (true), or below (false)",
  ),
  REPORT_ERRORS_TO: csv.default("").describe(
    "A comma-separated list of user or chat IDs that will receive notifications about any errors",
  ),
  BOT_API_ROOT: z.string().default("").describe(
    "A URL to a self-hosted Telegram Bot API server instance. " +
      "Read more: https://grammy.dev/guide/api#running-a-local-bot-api-server",
  ),
  BOT_ADMINS: intCsv.default("").describe(
    "A comma-separated list of user or chat IDs that can change bot settings",
  ),
  DATA_DIR: z.string().default("").describe(
    "A path to directory for storing app data, such as database files",
  ),
});

const env = {
  ...Deno.env.toObject(),
  ...dotenv.loadSync(),
};

export const config = Config.parse(env);
