import { autoRetry } from "@grammyjs/auto-retry";
import { Api } from "grammy";
import { config } from "../core/config.ts";

/**
 * Sends every upload of a file. A 2000 MB upload through the local Bot API
 * server can take many minutes, because the server passes the file on to
 * Telegram before it answers. The default client of the bot gives up after
 * 500 s. A network error or a timeout is not retried, because the retry would
 * upload the file again. A stream cannot even go twice: the first attempt used
 * it up, so the default client of the bot would retry it forever.
 */
export const uploadApi = new Api(config.BOT_TOKEN, {
  apiRoot: config.BOT_API_ROOT || undefined,
  timeoutSeconds: 60 * 60,
});
uploadApi.config.use(
  autoRetry({ maxRetryAttempts: 3, rethrowHttpErrors: true }),
);
