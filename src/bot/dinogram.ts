import { autoRetry } from "@grammyjs/auto-retry";
import {
  ConversationFlavor,
  conversations,
  createConversation,
} from "@grammyjs/conversations";
import { hydrateReply, ParseModeFlavor } from "@grammyjs/parse-mode";
import { run } from "@grammyjs/runner";
import type { Message, ReplyParameters } from "@grammyjs/types";
import { retry } from "@std/async/retry";
import {
  Bot,
  type Context,
  type Filter,
  session,
  type SessionFlavor,
} from "grammy";
import { ClientFactory } from "../client/client-factory.ts";
import { YouTubeClient } from "../client/youtube-client.ts";
import { YtDlp } from "../client/yt-dlp.ts";
import { config } from "../core/config.ts";
import { Downloads } from "../core/downloads.ts";
import { log } from "../core/log.ts";
import { messages } from "../core/messages.ts";
import { reportError } from "../utils/reports.ts";
import { isAdmin, isAllowed } from "./access.ts";
import { commands } from "./commands.ts";
import { dinoConversations } from "./conversations.ts";
import {
  handleChosenInlineResult,
  handleInlineQuery,
} from "./inline-handler.ts";
import { menus } from "./menus.ts";
import { UrlHandler } from "./url-handler.ts";
import {
  handleYouTubeCallback,
  handleYouTubeLink,
  YOUTUBE_CALLBACK,
} from "./youtube-handler.ts";

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
    await this.prepareYouTube();
    this.setupErrorHandler();
    this.listenToStopSignals();

    if (config.INLINE_ENABLED) {
      this.listenToInlineQueries();
    }

    this.bot.use(hydrateReply);
    this.bot.use(session({ initial: () => ({}) }));
    this.bot.use(conversations());
    this.bot.use(createConversation(dinoConversations.setInstagramCookie, {
      plugins: [hydrateReply],
    }));
    this.bot.use(createConversation(dinoConversations.setYouTubeCookie, {
      plugins: [hydrateReply],
    }));

    // Telegram runs a menu button from its callback data alone, so the
    // buttons check the admin again, the same way as the /settings command
    this.bot.filter(
      (ctx) => isAdmin(ctx.from?.id) || isAdmin(ctx.chat?.id),
      menus.settings,
    );
    for (const command in commands) {
      this.bot.command(command, commands[command]);
    }

    this.bot.callbackQuery(YOUTUBE_CALLBACK, handleYouTubeCallback);

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

  /**
   * A missing yt-dlp binary fails only when somebody sends a YouTube link, so
   * the start log says it up front
   */
  private async prepareYouTube() {
    if (!config.YOUTUBE_ENABLED) return;

    await Downloads.init();

    try {
      log.info(`Using yt-dlp ${await YtDlp.version()}`);
    } catch (e) {
      log.error(
        `yt-dlp is not available at "${config.YT_DLP_PATH}", so YouTube links will fail`,
        e,
      );
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

  /**
   * Inline queries and chosen results carry no chat, so these handlers run
   * before the middleware that expects one.
   */
  private listenToInlineQueries() {
    this.bot.on("inline_query", handleInlineQuery);
    this.bot.on("chosen_inline_result", handleChosenInlineResult);
  }

  private listenToUrlEntities() {
    this.bot.on("message:entities:url", async (ctx) => {
      const { from, chat } = ctx.message;

      if (!await isAllowed(from.id, chat.id)) {
        // The IDs go into the answer, because that is what the sender forwards
        // to an admin to ask for access.
        await ctx.reply(messages.NOT_ALLOWED(from.id, chat.id), {
          reply_parameters: {
            message_id: ctx.message.message_id,
            allow_sending_without_reply: true,
          },
        });
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

        const youtube = config.YOUTUBE_ENABLED
          ? YouTubeClient.parseLink(url)
          : null;

        if (youtube?.type === "playlist") {
          await ctx.reply(messages.YOUTUBE_PLAYLIST, {
            reply_parameters: {
              message_id: ctx.message.message_id,
              allow_sending_without_reply: true,
            },
          });
          continue;
        }

        const client = youtube ? null : ClientFactory.find(url);
        if (!youtube && !client) continue;

        const processingMessage = await ctx.api.sendMessage(
          ctx.chatId,
          `Processing ${client?.name ?? "YouTube"} link...`,
          {
            reply_parameters: config.SEND_AS_REPLY
              ? {
                message_id: ctx.message.message_id,
                allow_sending_without_reply: true,
                quote: urlText,
              } satisfies ReplyParameters
              : undefined,
          },
        );

        // The YouTube handler turns this message into its menu, so it keeps it
        if (youtube) {
          try {
            await handleYouTubeLink(ctx, youtube, processingMessage);
          } catch (e) {
            await reportError(
              ctx,
              `Error handling url ${urlText}`,
              e instanceof Error ? e : undefined,
            );
          }
          continue;
        }

        // The YouTube handler keeps the processing message as its menu, when a
        // post only shows a YouTube video
        let handedOver = false;
        try {
          const handler = new UrlHandler(ctx, ctx.message);
          const external = await handler.handle(client!);
          if (external) {
            handedOver = await this.handleExternalMedia(
              ctx,
              external,
              processingMessage,
            );
          }
        } catch (e) {
          reportError(
            ctx,
            `Error handling url ${urlText}`,
            e instanceof Error ? e : undefined,
          );
        } finally {
          if (!handedOver) {
            try {
              await ctx.api.deleteMessage(
                ctx.chatId,
                processingMessage.message_id,
              );
            } catch (e) {
              log.error("Failed to delete processing message", e);
            }
          }
        }
      }
    });
  }

  /**
   * A post can show media from another site, such as a YouTube video in a
   * pin. A YouTube video goes to the YouTube handler; any other link goes back
   * to the user. Returns true when the YouTube handler took the message over.
   */
  private async handleExternalMedia(
    ctx: Filter<DinoContext, "message:entities:url">,
    url: URL,
    processingMessage: Message,
  ): Promise<boolean> {
    const youtube = config.YOUTUBE_ENABLED
      ? YouTubeClient.parseLink(url)
      : null;

    if (youtube?.type === "video") {
      await handleYouTubeLink(ctx, youtube, processingMessage);
      return true;
    }

    await ctx.reply(messages.EXTERNAL_MEDIA(url.toString()), {
      reply_parameters: {
        message_id: ctx.message.message_id,
        allow_sending_without_reply: true,
      },
    });
    return false;
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
