import { autoRetry } from "@grammyjs/auto-retry";
import {
  ConversationFlavor,
  conversations,
  createConversation,
} from "@grammyjs/conversations";
import { run } from "@grammyjs/runner";
import { retry } from "@std/async/retry";
import { Bot, type Context, session, type SessionFlavor } from "grammy";
import { config } from "../core/config.ts";
import { log } from "../core/log.ts";
import { reportError } from "../utils/reports.ts";
import { commands } from "./commands.ts";
import { dinoConversations } from "./conversations.ts";
import { menus } from "./menus.ts";
import { UrlHandler } from "./url-handler.ts";
import { hydrateReply, ParseModeFlavor } from "@grammyjs/parse-mode";

export type DinoParseModeContext =
  & ParseModeFlavor<Context>
  & SessionFlavor<Record<string, unknown>>;

export type DinoContext = ConversationFlavor<DinoParseModeContext>;

export class Dinogram {
  bot: Bot<DinoContext>;

  constructor() {
    this.bot = new Bot<DinoContext>(config.BOT_TOKEN, {
      client: {
        apiRoot: config.BOT_API_ROOT ? config.BOT_API_ROOT : undefined,
      },
    });
    this.bot.api.config.use(autoRetry());
  }

  async launch() {
    await this.logoutFromBotApi();
    this.setupErrorHandler();
    this.listenToStopSignals();

    this.bot.use(hydrateReply);
    this.bot.use(session({ initial: () => ({}) }));
    this.bot.use(conversations());
    this.bot.use(createConversation(dinoConversations.setInstagramCookie, {
      plugins: [hydrateReply],
    }));

    this.bot.use(menus.settings);
    for (const command in commands) {
      this.bot.command(command, commands[command]);
    }

    this.listenToUrlEntities();

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
      const { ctx, error } = e;
      try {
        await reportError(
          ctx,
          "Unhandled bot error",
          error instanceof Error ? error : undefined,
        );
      } catch (cause) {
        log.error("Failed to report an error", cause);
      }
    });
  }

  private listenToUrlEntities() {
    this.bot.on("message:entities:url", async (ctx) => {
      if (!this.isRequestAuthorized(ctx.message.from.id, ctx.message.chat.id)) {
        ctx.reply(
          "🚫 Sorry. You are not authorized to make requests to this bot.",
        );
        return;
      }

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
          continue;
        }

        try {
          const handler = new UrlHandler(ctx, ctx.message, url);
          await handler.handle();
        } catch (e) {
          reportError(
            ctx,
            `Error handling url ${urlText}`,
            e instanceof Error ? e : undefined,
          );
        }
      }
    });
  }

  private isRequestAuthorized(userId: number, chatId: number): boolean {
    return config.WHITELIST.length === 0 ||
      config.WHITELIST.includes(userId) ||
      config.WHITELIST.includes(chatId);
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
