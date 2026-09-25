import {
  bold,
  fmt,
  type FormattedString,
  type Stringable,
} from "@grammyjs/parse-mode";
import {
  type CallbackQueryContext,
  type CommandContext,
  type Context,
  GrammyError,
  InlineKeyboard,
} from "grammy";
import { YouTubeChannels } from "../client/youtube-channels.ts";
import { YouTubeUserError } from "../client/youtube-client.ts";
import { db } from "../core/db.ts";
import { log } from "../core/log.ts";
import { messages } from "../core/messages.ts";
import type {
  Channel,
  Subscription,
  SubscriptionFormat,
  SubscriptionFrequency,
} from "../model/subscription.ts";
import { truncate } from "../utils/utils.ts";
import { isAllowed } from "./access.ts";
import { parseUrl } from "./inline-utils.ts";

export const SUBSCRIPTION_CALLBACK = /^sub:/;

/**
 * Each subscription checks one feed and can send ten videos per batch, so a
 * limit per user keeps the server within its means
 */
export const SUBSCRIPTION_LIMIT = 20;

const FORMATS: Record<SubscriptionFormat, { code: string; label: string }> = {
  high: { code: "h", label: "🎬 High · 1080p" },
  medium: { code: "m", label: "🎬 Medium · 720p" },
  low: { code: "l", label: "🎬 Low · 360p" },
  audio: { code: "a", label: "🎵 Audio" },
};

const FREQUENCIES: Record<
  SubscriptionFrequency,
  { code: string; label: string }
> = {
  instant: { code: "i", label: "⚡ As soon as posted" },
  daily: { code: "d", label: "📅 Once a day" },
  weekly: { code: "w", label: "🗓 Once a week" },
};

const formatOf = (code: string) =>
  (Object.keys(FORMATS) as SubscriptionFormat[])
    .find((it) => FORMATS[it].code === code);

const frequencyOf = (code: string) =>
  (Object.keys(FREQUENCIES) as SubscriptionFrequency[])
    .find((it) => FREQUENCIES[it].code === code);

/**
 * The fields of the callback data, separated by ":". The choices of the
 * subscribe steps travel in the data, so a step survives a restart.
 *
 * - nq, ns, nd: the new subscription after its format, frequency, and Shorts
 * - l: the list; d: one subscription; x: close the menu
 * - ef, eq: the format and frequency choices of a subscription
 * - sf, sq: set them; ts: turn Shorts on or off
 * - u: ask to unsubscribe; uy: unsubscribe
 */
function data(action: string, ...args: string[]): string {
  return ["sub", action, ...args].join(":");
}

/**
 * /subscribe <link to a channel or to one of its videos>
 */
export async function handleSubscribeCommand(ctx: CommandContext<Context>) {
  if (!await mayUse(ctx)) return;

  const url = ctx.match.trim().split(/\s+/).map(parseUrl).find(Boolean);
  if (!url) {
    await ctx.reply(messages.SUBSCRIPTION_HOW, {
      link_preview_options: { is_disabled: true },
    });
    return;
  }

  await startSubscription(ctx, url);
}

/**
 * /subscriptions lists the channels that the user follows
 */
export async function handleSubscriptionsCommand(
  ctx: CommandContext<Context>,
) {
  if (!await mayUse(ctx)) return;

  const view = await listView(ctx.from!.id);
  await ctx.reply(view.text.text, {
    entities: view.text.entities,
    reply_markup: view.keyboard,
  });
}

/**
 * Also runs when the user sends a channel link in the private chat
 */
export async function startSubscription(ctx: Context, url: URL) {
  const userId = ctx.from!.id;
  const status = await ctx.reply(messages.SUBSCRIPTION_LOOKING_UP);

  let channel: Channel;
  try {
    channel = await YouTubeChannels.resolve(url);
  } catch (e) {
    log.warn(`No channel found for ${url}: ${e}`);
    await ctx.api.editMessageText(
      status.chat.id,
      status.message_id,
      e instanceof YouTubeUserError
        ? e.message
        : messages.SUBSCRIPTION_NO_CHANNEL,
    );
    return;
  }

  await db.youtube.channel.set([channel.id], channel);

  const existing = await db.subscriptions.get(userId, channel.id);
  const view = existing
    ? detailView(existing, messages.SUBSCRIPTION_ALREADY)
    : formatStepView(channel);

  await ctx.api.editMessageText(
    status.chat.id,
    status.message_id,
    view.text.text,
    {
      entities: view.text.entities,
      reply_markup: view.keyboard,
    },
  );
}

export async function handleSubscriptionCallback(
  ctx: CallbackQueryContext<Context>,
) {
  const [, action, channelId = "", ...args] = ctx.callbackQuery.data.split(":");

  if (ctx.chat?.type !== "private" || !await isAllowed(ctx.from.id)) {
    await ctx.answerCallbackQuery({
      text: messages.SUBSCRIPTION_PRIVATE_ONLY,
      show_alert: true,
    }).catch(() => {});
    return;
  }

  try {
    const view = await viewFor(ctx.from.id, action, channelId, args);

    if (view === "close") {
      await ctx.deleteMessage();
    } else {
      await ctx.editMessageText(view.text.text, {
        entities: view.text.entities,
        reply_markup: view.keyboard,
        link_preview_options: { is_disabled: true },
      }).catch((e) => {
        if (!isNotModified(e)) throw e;
      });
    }

    await ctx.answerCallbackQuery();
  } catch (e) {
    log.error(`Subscription menu press ${ctx.callbackQuery.data} failed`, e);
    await ctx.answerCallbackQuery({
      text: truncate(
        e instanceof YouTubeUserError ? e.message : messages.YOUTUBE_OUTDATED,
        200,
      ),
      show_alert: true,
    }).catch(() => {});
  }
}

type View = { text: FormattedString; keyboard: InlineKeyboard };

async function viewFor(
  userId: number,
  action: string,
  channelId: string,
  args: string[],
): Promise<View | "close"> {
  switch (action) {
    case "x":
      return "close";
    case "l":
      return await listView(userId);
  }

  // Every other step belongs to one channel
  if (action.startsWith("n")) {
    const channel = await db.youtube.channel.get([channelId]);
    if (!channel) throw new YouTubeUserError(messages.YOUTUBE_OUTDATED);

    const [formatCode = "", frequencyCode = "", shortsCode = ""] = args;
    const format = formatOf(formatCode);
    const frequency = frequencyOf(frequencyCode);

    switch (action) {
      case "nf":
        return formatStepView(channel);
      case "nq":
        if (!format) break;
        return frequencyStepView(channel, format);
      case "ns":
        if (!format || !frequency) break;
        return shortsStepView(channel, format, frequency);
      case "nd":
        if (!format || !frequency) break;
        return await subscribe(
          userId,
          channel,
          format,
          frequency,
          shortsCode === "1",
        );
    }

    throw new YouTubeUserError(messages.YOUTUBE_OUTDATED);
  }

  const subscription = await db.subscriptions.get(userId, channelId);
  if (!subscription) return await listView(userId);

  switch (action) {
    case "d":
      return detailView(subscription);
    case "ef":
      return choiceView(
        subscription,
        messages.SUBSCRIPTION_ASK_FORMAT,
        formatRows(
          (format) => data("sf", channelId, FORMATS[format].code),
        ),
      );
    case "eq":
      return choiceView(
        subscription,
        messages.SUBSCRIPTION_ASK_FREQUENCY,
        frequencyRows((frequency) =>
          data("sq", channelId, FREQUENCIES[frequency].code)
        ),
      );
    case "sf": {
      const format = formatOf(args[0] ?? "");
      if (format) await db.subscriptions.set({ ...subscription, format });
      return detailView({
        ...subscription,
        format: format ?? subscription.format,
      });
    }
    case "sq": {
      const frequency = frequencyOf(args[0] ?? "");
      if (frequency) await db.subscriptions.set({ ...subscription, frequency });
      return detailView({
        ...subscription,
        frequency: frequency ?? subscription.frequency,
      });
    }
    case "ts": {
      const updated = { ...subscription, withShorts: !subscription.withShorts };
      await db.subscriptions.set(updated);
      return detailView(updated);
    }
    case "u":
      return {
        text: fmt([
          bold(subscription.channelTitle),
          "\n\n",
          messages.SUBSCRIPTION_UNSUBSCRIBE_ASK,
        ]),
        keyboard: new InlineKeyboard()
          .text("🗑 Unsubscribe", data("uy", channelId))
          .text("✖️ Keep it", data("d", channelId)),
      };
    case "uy": {
      await db.subscriptions.remove(userId, channelId);
      const view = await listView(userId);
      return {
        text: fmt([messages.SUBSCRIPTION_UNSUBSCRIBED, "\n\n", view.text]),
        keyboard: view.keyboard,
      };
    }
  }

  return detailView(subscription);
}

async function subscribe(
  userId: number,
  channel: Channel,
  format: SubscriptionFormat,
  frequency: SubscriptionFrequency,
  withShorts: boolean,
): Promise<View> {
  const existing = await db.subscriptions.get(userId, channel.id);
  if (existing) return detailView(existing, messages.SUBSCRIPTION_ALREADY);

  const count = (await db.subscriptions.listByUser(userId)).length;
  if (count >= SUBSCRIPTION_LIMIT) {
    throw new YouTubeUserError(messages.SUBSCRIPTION_LIMIT(SUBSCRIPTION_LIMIT));
  }

  // The videos in the feed now are old news, so only later ones arrive
  const feed = await YouTubeChannels.fetchFeed(channel.id);
  const now = Date.now();
  const subscription: Subscription = {
    userId,
    chatId: userId,
    channelId: channel.id,
    channelTitle: channel.title,
    format,
    frequency,
    withShorts,
    createdAt: now,
    lastDeliveredAt: now,
    pending: [],
    seen: feed.entries.map((it) => it.videoId),
  };

  await db.subscriptions.set(subscription);
  return detailView(subscription, messages.SUBSCRIPTION_DONE);
}

function formatStepView(channel: Channel): View {
  return {
    text: fmt([
      header(channel.title),
      "\n\n",
      messages.SUBSCRIPTION_ASK_FORMAT,
    ]),
    keyboard: formatRows((format) =>
      data("nq", channel.id, FORMATS[format].code)
    ).row().text("✖️ Cancel", data("x")),
  };
}

function frequencyStepView(channel: Channel, format: SubscriptionFormat): View {
  const f = FORMATS[format].code;
  return {
    text: fmt([
      header(channel.title),
      "\n",
      FORMATS[format].label,
      "\n\n",
      messages.SUBSCRIPTION_ASK_FREQUENCY,
    ]),
    keyboard: frequencyRows((frequency) =>
      data("ns", channel.id, f, FREQUENCIES[frequency].code)
    ).row().text(messages.YOUTUBE_BACK, data("nf", channel.id)),
  };
}

function shortsStepView(
  channel: Channel,
  format: SubscriptionFormat,
  frequency: SubscriptionFrequency,
): View {
  const f = FORMATS[format].code;
  const q = FREQUENCIES[frequency].code;
  return {
    text: fmt([
      header(channel.title),
      "\n",
      FORMATS[format].label,
      "\n",
      FREQUENCIES[frequency].label,
      "\n\n",
      messages.SUBSCRIPTION_ASK_SHORTS,
    ]),
    keyboard: new InlineKeyboard()
      .text("✅ With Shorts", data("nd", channel.id, f, q, "1"))
      .text("🚫 Without Shorts", data("nd", channel.id, f, q, "0"))
      .row()
      .text(messages.YOUTUBE_BACK, data("nq", channel.id, f)),
  };
}

async function listView(userId: number): Promise<View> {
  const subscriptions = await db.subscriptions.listByUser(userId);

  if (subscriptions.length === 0) {
    return {
      text: fmt([messages.SUBSCRIPTION_EMPTY]),
      keyboard: new InlineKeyboard(),
    };
  }

  const keyboard = new InlineKeyboard();
  for (const it of subscriptions) {
    keyboard.text(
      truncate(`${it.channelTitle} · ${short(it)}`, 60),
      data("d", it.channelId),
    ).row();
  }

  return {
    text: fmt([messages.SUBSCRIPTION_LIST(subscriptions.length)]),
    keyboard: keyboard.text("✖️ Close", data("x")),
  };
}

function detailView(subscription: Subscription, note?: string): View {
  const id = subscription.channelId;
  const parts: Stringable[] = [];

  if (note) parts.push(note, "\n\n");
  parts.push(
    header(subscription.channelTitle),
    "\n",
    FORMATS[subscription.format].label,
    "\n",
    FREQUENCIES[subscription.frequency].label,
    "\n",
    subscription.withShorts ? "🩳 With Shorts" : "🩳 Without Shorts",
  );
  if (subscription.pending.length > 0) {
    parts.push(
      "\n",
      messages.SUBSCRIPTION_PENDING(subscription.pending.length),
    );
  }

  return {
    text: fmt(parts),
    keyboard: new InlineKeyboard()
      .text("🎞 Format", data("ef", id))
      .text("⏱ Frequency", data("eq", id))
      .row()
      .text(
        subscription.withShorts ? "🩳 Turn Shorts off" : "🩳 Turn Shorts on",
        data("ts", id),
      )
      .row()
      .text("🗑 Unsubscribe", data("u", id))
      .text("⬅️ All subscriptions", data("l")),
  };
}

function choiceView(
  subscription: Subscription,
  question: string,
  keyboard: InlineKeyboard,
): View {
  return {
    text: fmt([header(subscription.channelTitle), "\n\n", question]),
    keyboard: keyboard.row().text(
      messages.YOUTUBE_BACK,
      data("d", subscription.channelId),
    ),
  };
}

function formatRows(
  dataOf: (format: SubscriptionFormat) => string,
): InlineKeyboard {
  return new InlineKeyboard()
    .text(FORMATS.high.label, dataOf("high"))
    .text(FORMATS.medium.label, dataOf("medium"))
    .row()
    .text(FORMATS.low.label, dataOf("low"))
    .text(FORMATS.audio.label, dataOf("audio"));
}

function frequencyRows(
  dataOf: (frequency: SubscriptionFrequency) => string,
): InlineKeyboard {
  return new InlineKeyboard()
    .text(FREQUENCIES.instant.label, dataOf("instant"))
    .row()
    .text(FREQUENCIES.daily.label, dataOf("daily"))
    .text(FREQUENCIES.weekly.label, dataOf("weekly"));
}

function header(title: string): FormattedString {
  return fmt(["🔔 ", bold(truncate(title, 100))]);
}

/**
 * "720p · daily" for the list buttons
 */
function short(subscription: Subscription): string {
  const format = {
    high: "1080p",
    medium: "720p",
    low: "360p",
    audio: "audio",
  }[subscription.format];
  return `${format} · ${subscription.frequency}`;
}

/**
 * Subscriptions live in the private chat, where the videos arrive
 */
async function mayUse(ctx: CommandContext<Context>): Promise<boolean> {
  if (ctx.chat.type !== "private") {
    await ctx.reply(messages.SUBSCRIPTION_PRIVATE_ONLY);
    return false;
  }

  if (!await isAllowed(ctx.from!.id)) {
    await ctx.reply(messages.NOT_ALLOWED(ctx.from!.id, ctx.chat.id));
    return false;
  }

  return true;
}

function isNotModified(error: unknown): boolean {
  return error instanceof GrammyError &&
    /message is not modified/i.test(error.description);
}
