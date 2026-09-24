import type { FormattedString } from "@grammyjs/parse-mode";
import type { MaybeInaccessibleMessage, Message, User } from "@grammyjs/types";
import {
  type Api,
  type CallbackQueryContext,
  type Context,
  type Filter,
  GrammyError,
  InlineKeyboard,
} from "grammy";
import { YouTubeClient, YouTubeUserError } from "../client/youtube-client.ts";
import { db } from "../core/db.ts";
import { log } from "../core/log.ts";
import { messages } from "../core/messages.ts";
import type {
  YouTubeCard,
  YouTubeLink,
  YouTubeOption,
  YouTubeVideo,
} from "../model/youtube.ts";
import { reportError } from "../utils/reports.ts";
import { formatSize, truncate } from "../utils/utils.ts";
import { isAdmin, isAllowed } from "./access.ts";
import { CaptionBuilder } from "./caption-builder.ts";
import {
  busyUsers,
  deliver,
  statusApi,
  statusUpdater,
} from "./youtube-delivery.ts";

type MessageContext = Filter<Context, "message">;
type YouTubeVideoLink = Extract<YouTubeLink, { type: "video" }>;

export const YOUTUBE_CALLBACK = /^yt:/;

/**
 * Telegram shows this bot as the sender of a message that an anonymous group
 * admin sends
 */
const GROUP_ANONYMOUS_BOT_ID = 1087968824;

/**
 * Menu cards whose download runs, keyed by chat and message. The first choice
 * wins, because the card turns into that file.
 */
const busyCards = new Set<string>();

/**
 * The fields of the callback data, separated by ":"
 *
 * - action: k (video or audio), f (format), b (back), c (close), x (cancel)
 * - arg: "v" or "a" for k, the format selector for f
 * - card: the message ID of the public menu card, set only on the buttons of
 *   a private picker, because a press there does not point at the card
 */
type CallbackData = {
  readonly action: string;
  readonly videoId: string;
  readonly arg: string;
  readonly card?: number;
};

function encode(data: CallbackData): string {
  const encoded = ["yt", data.action, data.videoId, data.arg, data.card ?? ""]
    .join(":");

  // Telegram rejects callback data over 64 bytes. The longest one, a format
  // selector of a dubbed video with a card ID, takes about 40.
  if (encoded.length > 64) {
    throw new Error(`Callback data exceeds 64 bytes: ${encoded}`);
  }

  return encoded;
}

function decode(data: string): CallbackData {
  const [, action, videoId, arg, card] = data.split(":");

  return {
    action,
    videoId,
    arg,
    card: card ? Number(card) : undefined,
  };
}

/**
 * Takes over the "Processing" message: it turns into the menu card, or for a
 * Short, straight into the video.
 */
export async function handleYouTubeLink(
  ctx: MessageContext,
  link: YouTubeVideoLink,
  processing: Message,
) {
  const chatId = processing.chat.id;
  const messageId = processing.message_id;

  let video: YouTubeVideo;
  try {
    video = await YouTubeClient.fetchVideo(link.id);
  } catch (e) {
    await deleteMessage(ctx.api, chatId, messageId);
    await reportError(
      ctx,
      reasonOf(e, "Error fetching YouTube video details"),
      e,
    );
    return;
  }

  if (link.isShort || video.isShort) {
    await sendShort(ctx, video, processing);
    return;
  }

  if (video.videoOptions.length === 0 && video.audioOptions.length === 0) {
    await ctx.api.editMessageText(
      chatId,
      messageId,
      messages.YOUTUBE_NO_OPTIONS,
    );
    return;
  }

  // The record exists before the buttons, so that a fast press finds it
  await db.youtube.card.set(cardKey(chatId, messageId), {
    videoId: video.id,
    owner: ownerOf(ctx.message),
    state: "open",
  });

  const caption = CaptionBuilder.youtubeCard(
    video,
    messages.YOUTUBE_CHOOSE_FORMAT,
  );
  const keyboard = kindKeyboard(video);

  try {
    await ctx.api.editMessageMedia(chatId, messageId, {
      type: "photo",
      media: YouTubeClient.thumbnailUrl(video.id, "hq"),
      caption: caption.text,
      caption_entities: caption.entities,
    }, { reply_markup: keyboard });
  } catch (e) {
    log.warn(`The menu card has no thumbnail: ${e}`);
    await ctx.api.editMessageText(chatId, messageId, caption.text, {
      entities: caption.entities,
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    });
  }
}

/**
 * A Short is as brief as a TikTok video, so it comes at once, in the best
 * size that fits, with no menu
 */
async function sendShort(
  ctx: MessageContext,
  video: YouTubeVideo,
  processing: Message,
) {
  const chatId = processing.chat.id;
  const messageId = processing.message_id;

  const option = video.videoOptions[0];
  if (!option) {
    await ctx.api.editMessageText(
      chatId,
      messageId,
      messages.YOUTUBE_NO_OPTIONS,
    );
    return;
  }

  const status = statusUpdater((text) =>
    statusApi.editMessageText(chatId, messageId, text)
  );

  try {
    await deliver(
      video,
      option,
      { type: "message", chatId, messageId, threadId: topicOf(processing) },
      CaptionBuilder.youtube(video),
      status,
    );
  } catch (e) {
    await status.idle();
    await deleteMessage(ctx.api, chatId, messageId);
    await reportError(
      ctx,
      reasonOf(e, "Error downloading the YouTube Short"),
      e,
    );
  }
}

/**
 * Handles the buttons of the menu card and of the private picker.
 *
 * In a group, a press on the public card opens a private picker: an ephemeral
 * message that only the member who pressed sees, in place of the card. The
 * card itself changes only when a download starts. In a private chat, or when
 * the private picker fails, the card itself changes.
 */
export async function handleYouTubeCallback(
  ctx: CallbackQueryContext<Context>,
) {
  const data = decode(ctx.callbackQuery.data);
  const message = ctx.callbackQuery.message;

  if (!message || !data.videoId) {
    await answer(ctx);
    return;
  }

  const chatId = message.chat.id;

  if (!await isAllowed(ctx.from.id, chatId)) {
    await alert(ctx, messages.INLINE_UNAUTHORIZED);
    return;
  }

  const ephemeralId = "ephemeral_message_id" in message
    ? message.ephemeral_message_id
    : undefined;

  // A private picker names the card that it belongs to. Any other press comes
  // from the card itself, so its own ID wins over the callback data.
  const cardId = ephemeralId !== undefined ? data.card : message.message_id;
  const card = cardId === undefined
    ? null
    : await db.youtube.card.get(cardKey(chatId, cardId));

  if (cardId === undefined || !card || card.videoId !== data.videoId) {
    await alert(ctx, messages.YOUTUBE_OUTDATED);
    return;
  }

  const base = {
    ctx,
    data,
    chatId,
    isGroup: ["group", "supergroup"].includes(message.chat.type),
    threadId: topicOf(message),
    cardId,
    card,
    ephemeralId,
  };

  try {
    // Closing and cancelling need no video, so they work even when YouTube
    // no longer serves it
    if (data.action === "c") return await closePicker(base);
    if (data.action === "x") return await cancel(base);

    if (card.state === "done") {
      await alert(ctx, messages.YOUTUBE_BUSY_CARD);
      return;
    }

    let video: YouTubeVideo;
    try {
      video = await YouTubeClient.fetchVideo(data.videoId);
    } catch (e) {
      await alert(ctx, reasonOf(e, messages.YOUTUBE_OUTDATED));
      return;
    }

    const press: Press = { ...base, video };

    switch (data.action) {
      case "k":
        return await chooseKind(press, data.arg === "a" ? "a" : "v");
      case "b":
        return await goBack(press);
      case "f":
        return await chooseFormat(press);
      default:
        await answer(ctx);
    }
  } catch (e) {
    log.error(`YouTube menu press ${ctx.callbackQuery.data} failed`, e);
    // Stops the spinner on the button, unless the press was answered already
    await alert(ctx, messages.YOUTUBE_OUTDATED);
  }
}

type BasePress = {
  readonly ctx: CallbackQueryContext<Context>;
  readonly data: CallbackData;
  readonly chatId: number;
  readonly isGroup: boolean;
  readonly threadId?: number;
  /** The public menu card */
  readonly cardId: number;
  readonly card: YouTubeCard;
  /** Set when the press came from a private picker */
  readonly ephemeralId?: number;
};

type Press = BasePress & { readonly video: YouTubeVideo };

async function chooseKind(press: Press, kind: "v" | "a") {
  const { ctx, video, chatId } = press;
  const caption = CaptionBuilder.youtubeCard(
    video,
    kind === "v"
      ? messages.YOUTUBE_CHOOSE_VIDEO
      : messages.YOUTUBE_CHOOSE_AUDIO,
  );

  if (press.ephemeralId !== undefined) {
    await editPicker(
      press,
      caption,
      qualityKeyboard(video, kind, press.cardId),
    );
    await answer(ctx);
    return;
  }

  if (busyCards.has(busyKey(chatId, press.cardId))) {
    await alert(ctx, messages.YOUTUBE_BUSY_CARD);
    return;
  }

  if (press.isGroup && await sendPicker(press, caption, kind)) {
    await answer(ctx);
    return;
  }

  await editCard(
    ctx.api,
    chatId,
    press.cardId,
    caption,
    qualityKeyboard(video, kind),
  );
  await answer(ctx);
}

/**
 * Returns false when the private picker failed, so that the caller changes
 * the public card instead
 */
async function sendPicker(
  press: Press,
  caption: FormattedString,
  kind: "v" | "a",
): Promise<boolean> {
  const { ctx } = press;

  try {
    await ctx.api.sendMessage(press.chatId, caption.text, {
      entities: caption.entities,
      reply_markup: qualityKeyboard(press.video, kind, press.cardId),
      message_thread_id: press.threadId,
      link_preview_options: { is_disabled: true },
      ephemeral_message_parameters: {
        receiver_user_id: ctx.from.id,
        callback_query_id: ctx.callbackQuery.id,
        replace_callback_query_message: true,
      },
    });
    return true;
  } catch (e) {
    log.warn(
      `The private picker failed, so the card changes for everyone: ${e}`,
    );
    return false;
  }
}

async function goBack(press: Press) {
  const { ctx, video } = press;
  const caption = CaptionBuilder.youtubeCard(
    video,
    messages.YOUTUBE_CHOOSE_FORMAT,
  );

  if (press.ephemeralId !== undefined) {
    await editPicker(press, caption, kindKeyboard(video, press.cardId));
  } else {
    await editCard(
      ctx.api,
      press.chatId,
      press.cardId,
      caption,
      kindKeyboard(video),
    );
  }

  await answer(ctx);
}

async function closePicker(press: BasePress) {
  if (press.ephemeralId !== undefined) {
    await press.ctx.api.deleteEphemeralMessage(
      press.chatId,
      press.ctx.from.id,
      press.ephemeralId,
    ).catch((e) => log.debug(`Could not close the picker: ${e}`));
  }

  await answer(press.ctx);
}

async function cancel(press: BasePress) {
  const { ctx, card } = press;

  // Only the public card has a Cancel button
  if (press.ephemeralId !== undefined) {
    await answer(ctx);
    return;
  }

  if (busyCards.has(busyKey(press.chatId, press.cardId))) {
    await alert(ctx, messages.YOUTUBE_BUSY_CARD);
    return;
  }

  const mayCancel = !press.isGroup || card.owner === 0 ||
    card.owner === ctx.from.id || isAdmin(ctx.from.id);
  if (!mayCancel) {
    await alert(ctx, messages.YOUTUBE_CANCEL_DENIED);
    return;
  }

  await deleteMessage(ctx.api, press.chatId, press.cardId);
  await db.youtube.card.delete(cardKey(press.chatId, press.cardId));
  await answer(ctx);
}

async function chooseFormat(press: Press) {
  const { ctx, video, data, chatId, cardId } = press;
  const user = ctx.from;

  const option = [...video.videoOptions, ...video.audioOptions]
    .find((it) => it.formatId === data.arg);
  if (!option) {
    await alert(ctx, messages.YOUTUBE_OUTDATED);
    return;
  }

  const key = busyKey(chatId, cardId);
  if (busyCards.has(key)) {
    await alert(ctx, messages.YOUTUBE_BUSY_CARD);
    return;
  }
  if (busyUsers.has(user.id)) {
    await alert(ctx, messages.YOUTUBE_BUSY_USER);
    return;
  }

  busyCards.add(key);
  busyUsers.add(user.id);

  try {
    await answer(ctx);

    // The member now follows the download on the public card
    if (press.ephemeralId !== undefined) {
      await ctx.api.deleteEphemeralMessage(chatId, user.id, press.ephemeralId)
        .catch((e) => log.debug(`Could not close the picker: ${e}`));
    }

    const delivered = await download(
      press,
      option,
      press.isGroup ? user : undefined,
    );

    // The card is a file now, so the pickers that other members still have
    // open must not replace it
    if (delivered) {
      await db.youtube.card.set(cardKey(chatId, cardId), {
        ...press.card,
        state: "done",
      });
    }
  } finally {
    busyCards.delete(key);
    busyUsers.delete(user.id);
  }
}

/**
 * Returns true when the card turned into the file
 */
async function download(
  press: Press,
  option: YouTubeOption,
  requester: User | undefined,
): Promise<boolean> {
  const { ctx, video, chatId, cardId } = press;

  // Without a keyboard, nobody can press the card while it downloads
  const status = statusUpdater((text) =>
    editCard(
      statusApi,
      chatId,
      cardId,
      CaptionBuilder.youtubeCard(video, text, requester),
    )
  );

  try {
    await deliver(
      video,
      option,
      { type: "message", chatId, messageId: cardId, threadId: press.threadId },
      CaptionBuilder.youtube(video, { requester }),
      status,
    );
    return true;
  } catch (e) {
    await status.idle();

    // The menu comes back, so that anybody can try again
    await editCard(
      ctx.api,
      chatId,
      cardId,
      CaptionBuilder.youtubeCard(video, messages.YOUTUBE_FAILED),
      kindKeyboard(video),
    ).catch((e) => log.error(`Could not restore the menu: ${e}`));

    await reportError(
      ctx,
      reasonOf(e, "Error downloading the YouTube video"),
      e,
    );
    return false;
  }
}

/**
 * @param card the public card, when the keyboard belongs to a private picker
 */
function kindKeyboard(video: YouTubeVideo, card?: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const data = (action: string, arg = "") =>
    encode({ action, videoId: video.id, arg, card });

  if (video.videoOptions.length > 0) {
    keyboard.text(messages.YOUTUBE_VIDEO, data("k", "v"));
  }
  if (video.audioOptions.length > 0) {
    keyboard.text(messages.YOUTUBE_AUDIO, data("k", "a"));
  }

  keyboard.row();

  // A private picker closes; only the public card can be cancelled
  return card === undefined
    ? keyboard.text(messages.YOUTUBE_CANCEL, data("x"))
    : keyboard.text(messages.YOUTUBE_CLOSE, data("c"));
}

function qualityKeyboard(
  video: YouTubeVideo,
  kind: "v" | "a",
  card?: number,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const options = kind === "v" ? video.videoOptions : video.audioOptions;

  options.forEach((option, index) => {
    keyboard.text(
      `${option.label} · ${formatSize(option.size)}`,
      encode({ action: "f", videoId: video.id, arg: option.formatId, card }),
    );

    // Two buttons per row fit a phone screen
    if (index % 2 === 1) keyboard.row();
  });

  return keyboard
    .row()
    .text(
      messages.YOUTUBE_BACK,
      encode({ action: "b", videoId: video.id, arg: "", card }),
    );
}

/**
 * The card is a photo, or text when the thumbnail failed. Its type is unknown
 * after a press in a private picker, so the caption edit comes first.
 */
async function editCard(
  api: Api,
  chatId: number,
  messageId: number,
  caption: FormattedString,
  keyboard?: InlineKeyboard,
) {
  try {
    await api.editMessageCaption(chatId, messageId, {
      caption: caption.text,
      caption_entities: caption.entities,
      reply_markup: keyboard,
    });
  } catch (e) {
    if (isNotModified(e)) return;
    if (!(e instanceof GrammyError && /no caption/i.test(e.description))) {
      throw e;
    }

    await api.editMessageText(chatId, messageId, caption.text, {
      entities: caption.entities,
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    }).catch((e) => {
      if (!isNotModified(e)) throw e;
    });
  }
}

function editPicker(
  press: Press,
  caption: FormattedString,
  keyboard: InlineKeyboard,
) {
  return press.ctx.api.editEphemeralMessageText(
    press.chatId,
    press.ctx.from.id,
    press.ephemeralId!,
    caption.text,
    {
      entities: caption.entities,
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    },
  ).catch((e) => {
    if (!isNotModified(e)) throw e;
  });
}

/**
 * The user who may cancel the card. Nobody owns the link of an anonymous
 * admin or of a channel, so anybody may cancel that card.
 */
function ownerOf(message: Message): number {
  if (message.sender_chat || !message.from) return 0;
  if (message.from.id === GROUP_ANONYMOUS_BOT_ID) return 0;
  return message.from.id;
}

/**
 * A reply in a group without topics also has a thread ID, which Telegram
 * rejects in a send. Only a message in a forum topic passes its thread on.
 */
function topicOf(message: MaybeInaccessibleMessage): number | undefined {
  return "is_topic_message" in message && message.is_topic_message
    ? message.message_thread_id
    : undefined;
}

function cardKey(chatId: number, messageId: number): string[] {
  return [String(chatId), String(messageId)];
}

function busyKey(chatId: number, messageId: number): string {
  return `${chatId}:${messageId}`;
}

/**
 * Telegram refuses a second answer, and an answer after about 15 s. Neither
 * must stop the work that follows.
 */
function answer(ctx: CallbackQueryContext<Context>) {
  return ctx.answerCallbackQuery()
    .catch((e) => log.debug(`Could not answer the press: ${e}`));
}

function alert(ctx: CallbackQueryContext<Context>, text: string) {
  return ctx.answerCallbackQuery({
    text: truncate(text, 200),
    show_alert: true,
  })
    .catch((e) => log.debug(`Could not answer the press: ${e}`));
}

function reasonOf(error: unknown, fallback: string): string {
  return error instanceof YouTubeUserError ? error.message : fallback;
}

function isNotModified(error: unknown): boolean {
  return error instanceof GrammyError &&
    /message is not modified/i.test(error.description);
}

async function deleteMessage(api: Api, chatId: number, messageId: number) {
  try {
    await api.deleteMessage(chatId, messageId);
  } catch (e) {
    log.error("Failed to delete the processing message", e);
  }
}
