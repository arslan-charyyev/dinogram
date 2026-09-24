import { type Context, type Filter, GrammyError, InlineKeyboard } from "grammy";
import { config } from "../core/config.ts";
import { messages } from "../core/messages.ts";

export type InlineQueryContext = Filter<Context, "inline_query">;
export type ChosenResultContext = Filter<Context, "chosen_inline_result">;

/**
 * An empty result list with a button is the only way to tell the user what
 * went wrong, because Telegram shows no other text above inline results.
 */
export function answerWithHint(ctx: InlineQueryContext, text: string) {
  return ctx.answerInlineQuery([], {
    cache_time: 0,
    is_personal: true,
    button: { text: text, start_parameter: "inline" },
  });
}

export function originalPostKeyboard(url: URL): InlineKeyboard {
  return new InlineKeyboard().url(
    messages.INLINE_OPEN_ORIGINAL,
    url.toString(),
  );
}

/**
 * A storage chat is unreachable until the user starts a chat with the bot, so
 * that failure gets an instruction instead of a raw error.
 */
export function inlineErrorReason(error: unknown, url: string): string {
  const isForbidden = error instanceof GrammyError && error.error_code === 403;

  return isForbidden && !config.INLINE_STORAGE_CHAT
    ? messages.INLINE_START_BOT
    : `Error handling url ${url}`;
}

export function parseUrl(word: string): URL | null {
  const text = word.trim();
  if (text.length === 0) return null;

  try {
    return new URL(text);
  } catch (_e) {
    // Telegram marks no entities in an inline query, so a link that the user
    // pasted without a scheme still has to be recognized.
    if (!text.includes(".")) return null;

    try {
      return new URL(`https://${text}`);
    } catch (_e) {
      return null;
    }
  }
}
