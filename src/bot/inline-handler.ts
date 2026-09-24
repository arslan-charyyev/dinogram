import { FormattedString } from "@grammyjs/parse-mode";
import type { Message } from "@grammyjs/types";
import { InputFile } from "grammy";
import { ClientFactory } from "../client/client-factory.ts";
import type { PlatformClient } from "../client/platform-client.ts";
import { YouTubeClient } from "../client/youtube-client.ts";
import { config } from "../core/config.ts";
import { log } from "../core/log.ts";
import { messages } from "../core/messages.ts";
import type { FilePost } from "../model/post.ts";
import type { YouTubeLink } from "../model/youtube.ts";
import { reportInlineError } from "../utils/reports.ts";
import { truncate } from "../utils/utils.ts";
import { isAllowed } from "./access.ts";
import { CaptionBuilder } from "./caption-builder.ts";
import {
  answerWithHint,
  type ChosenResultContext,
  inlineErrorReason,
  type InlineQueryContext,
  originalPostKeyboard,
  parseUrl,
} from "./inline-utils.ts";
import {
  answerYouTubeInlineQuery,
  handleYouTubeChosenResult,
  YOUTUBE_RESULT_PREFIX,
} from "./youtube-inline.ts";

type UploadedMedia = {
  readonly type: "photo" | "video" | "animation";
  readonly fileId: string;
};

/**
 * Inline mode lets the user tag the bot in any chat, including a private chat
 * that the bot is not a member of. Telegram delivers the tagged text without
 * entities, and it expects an answer within a few seconds. Therefore the bot
 * answers with a placeholder message and downloads the media only after the
 * user picks the result.
 */
export async function handleInlineQuery(ctx: InlineQueryContext) {
  const { query, from } = ctx.inlineQuery;

  if (!await isAllowed(from.id)) {
    await answerWithHint(ctx, messages.INLINE_UNAUTHORIZED);
    return;
  }

  const youtube = findYouTubeLink(query);
  if (youtube?.type === "playlist") {
    await answerWithHint(ctx, messages.YOUTUBE_PLAYLIST);
    return;
  }
  if (youtube) {
    await answerYouTubeInlineQuery(ctx, youtube);
    return;
  }

  const match = findSupportedUrl(query);
  if (!match) {
    await answerWithHint(ctx, messages.INLINE_NO_LINK);
    return;
  }

  const { url, client } = match;

  await ctx.answerInlineQuery([{
    type: "article",
    id: "download",
    title: `${messages.INLINE_RESULT_TITLE} ${client.name}`,
    description: truncate(url.toString(), 100),
    input_message_content: { message_text: messages.INLINE_DOWNLOADING },
    // Telegram reports the ID of the sent message only when the message
    // carries an inline keyboard. Without that ID the bot cannot replace the
    // placeholder with the media.
    reply_markup: originalPostKeyboard(url),
  }], {
    cache_time: 0,
    is_personal: true,
  });
}

/**
 * Telegram sends this update only when inline feedback is enabled for the bot
 * in the BotFather. See the `Inline mode` section of the README.
 */
export async function handleChosenInlineResult(ctx: ChosenResultContext) {
  const { inline_message_id: inlineMessageId, query } = ctx.chosenInlineResult;

  if (!inlineMessageId) {
    log.error("Chosen inline result carries no inline_message_id");
    return;
  }

  if (ctx.chosenInlineResult.result_id.startsWith(YOUTUBE_RESULT_PREFIX)) {
    await handleYouTubeChosenResult(ctx, inlineMessageId);
    return;
  }

  const match = findSupportedUrl(query);
  if (!match) {
    // The link was supported when the result card was built, so a miss here
    // means that the configuration changed in between.
    await ctx.api.editMessageTextInline(
      inlineMessageId,
      messages.INLINE_NO_LINK,
    );
    return;
  }

  const { url, client } = match;

  try {
    const post = await client.fetchPost();
    const uploaded = await uploadToStorage(ctx, client, post);
    const caption = CaptionBuilder.inline(post);

    await ctx.api.editMessageMediaInline(
      inlineMessageId,
      buildInputMedia(uploaded, caption),
      { reply_markup: originalPostKeyboard(url) },
    );

    log.debug(`Sent inline ${client.name} ${uploaded.type}`);
  } catch (e) {
    await reportInlineError(
      ctx,
      inlineMessageId,
      inlineErrorReason(e, url.toString()),
      e,
    );
  }
}

/**
 * An inline message cannot carry a freshly uploaded file, so the media first
 * goes to a storage chat, which gives us a reusable file ID.
 */
async function uploadToStorage(
  ctx: ChosenResultContext,
  client: PlatformClient,
  post: FilePost,
): Promise<UploadedMedia> {
  const file = post.type === "single" ? post.file : post.files[0];
  const stream = await client.getByteStream(file.downloadUrl);
  const chatId = config.INLINE_STORAGE_CHAT || ctx.chosenInlineResult.from.id;
  const inputFile = new InputFile(stream);
  const other = { disable_notification: true };

  let message: Message;
  switch (file.type) {
    case "video":
      message = await ctx.api.sendVideo(chatId, inputFile, other);
      break;
    case "photo":
      message = await ctx.api.sendPhoto(chatId, inputFile, other);
      break;
  }

  const uploaded = extractMedia(message);
  if (!uploaded) {
    throw Error("Storage chat message carries no media", { cause: message });
  }

  // The file ID outlives the message, so the upload leaves no trace behind.
  try {
    await ctx.api.deleteMessage(chatId, message.message_id);
  } catch (e) {
    log.error("Failed to delete the storage chat message", e);
  }

  return uploaded;
}

function extractMedia(message: Message): UploadedMedia | null {
  // Telegram turns a video without an audio track into an animation
  if (message.animation) {
    return { type: "animation", fileId: message.animation.file_id };
  }

  if (message.video) {
    return { type: "video", fileId: message.video.file_id };
  }

  // The last entry is the largest available size
  const photo = message.photo?.at(-1);
  if (photo) {
    return { type: "photo", fileId: photo.file_id };
  }

  return null;
}

function buildInputMedia(uploaded: UploadedMedia, caption: FormattedString) {
  const common = {
    media: uploaded.fileId,
    caption: caption.text,
    caption_entities: caption.entities,
  };

  switch (uploaded.type) {
    case "photo":
      return { type: "photo" as const, ...common };
    case "video":
      return { type: "video" as const, ...common };
    case "animation":
      return { type: "animation" as const, ...common };
  }
}

function findSupportedUrl(
  query: string,
): { url: URL; client: PlatformClient } | null {
  for (const word of query.split(/\s+/)) {
    const url = parseUrl(word);
    if (!url) continue;

    if (!["http:", "https:"].includes(url.protocol)) continue;

    const client = ClientFactory.find(url);
    if (client) return { url, client };
  }

  return null;
}

function findYouTubeLink(query: string): YouTubeLink | null {
  if (!config.YOUTUBE_ENABLED) return null;

  for (const word of query.split(/\s+/)) {
    const url = parseUrl(word);
    if (!url) continue;

    if (!["http:", "https:"].includes(url.protocol)) continue;

    const link = YouTubeClient.parseLink(url);
    if (link) return link;
  }

  return null;
}
