import { Bot } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { run } from "@grammyjs/runner";
import { config } from "../core/config.ts";
import { log } from "../core/log.ts";
import { UrlHandler } from "./url-handler.ts";
import { reportError } from "../utils/reports.ts";
import { retry } from "@std/async/retry";

export class Dinogram {
  bot: Bot;

  constructor() {
    this.bot = new Bot(config.BOT_TOKEN, {
      client: {
        apiRoot: config.BOT_API_ROOT ? config.BOT_API_ROOT : undefined,
      },
    });
    this.bot.api.config.use(autoRetry());
  }

  async launch() {
    await this.logoutFromBotApi();
    this.setupErrorHandler();
    this.listenToUrlEntities();
    this.listenToStopSignals();

    this.bot.init().then(() => {
      const { first_name, username } = this.bot.botInfo;
      log.info(`🚀 Launching bot "${first_name}" with username: @${username}`);
    });

    run(this.bot);
  }

  /**
   * When using custom Bot API server, we need to log out of the default one.
   * See {@link  https://grammy.dev/guide/api#logging-out-of-the-hosted-bot-api-server Grammy docs}.
   */
  private async logoutFromBotApi() {
    if (!config.BOT_API_ROOT) return;

    const telegramApiHost = "api.telegram.org";

    try {
      const url = new URL(config.BOT_API_ROOT);
      if (url.host === telegramApiHost) return;

      await retry(() =>
        fetch(`https://${telegramApiHost}/bot${config.BOT_TOKEN}/logOut`)
      );

      log.info(`Logged out from the ${telegramApiHost} server`);
    } catch (e) {
      log.error("Failed to logout from Bot API", e);
    }
  }

  private setupErrorHandler() {
    this.bot.catch(async (e) => {
      const { ctx, ...error } = e;
      try {
        await reportError(ctx, "Unhandled bot error", error);
      } catch (cause) {
        log.error("Failed to report an error", cause);
      }
    });
  }

  private listenToUrlEntities() {
    this.bot.on("message:entities:url", async (ctx) => {
      for (const entity of ctx.entities("url")) {
        const urlText: string = entity.text.trim();

        let url: URL;
        try {
          log.debug(`Processing ${urlText}`);

          url = new URL(urlText);
        } catch (_e) {
          // Happens when message contains string like 'word.another',
          // which Telegram interprets as a URL in the form of 'host.domain'.
          // No need to report such errors
          // reportError(ctx, `Error parsing url ${urlText}`, e);
          continue;
        }

        if (!["http:", "https:"].includes(url.protocol)) {
          log.debug(`Skipping non http(s) protocol: ${(url.protocol)}`);
          continue;
        }

        try {
          const handler = new UrlHandler(ctx, ctx.message, url);
          await handler.handle();
        } catch (e) {
          reportError(ctx, `Error handling url ${urlText}`, e);
        }
      }
    });
  }

  private listenToStopSignals() {
    // Stop the bot when the Deno process has received termination signal
    const stopSignals: Deno.Signal[] = [];

    switch (Deno.build.os) {
      case "linux":
        stopSignals.push("SIGINT", "SIGTERM");
        break;
      case "windows":
        stopSignals.push("SIGINT", "SIGBREAK");
        break;
    }

    for (const signal of stopSignals) {
      Deno.addSignalListener(signal, this.bot.stop);
    }
  }
}
