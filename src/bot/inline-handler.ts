import { FormattedString } from "@grammyjs/parse-mode";
import type { InlineQueryResultArticle, Message } from "@grammyjs/types";
import { GrammyError, InlineKeyboard, InputFile } from "grammy";
import { ClientFactory } from "../client/client-factory.ts";
import type { PlatformClient } from "../client/platform-client.ts";
import { YouTubeClient } from "../client/youtube-client.ts";
import { config } from "../core/config.ts";
import { log } from "../core/log.ts";
import { messages } from "../core/messages.ts";
import type { SingleMediaFile } from "../model/file.ts";
import type { FilePost, MultiFilePost } from "../model/post.ts";
import type { YouTubeLink } from "../model/youtube.ts";
import { reportInlineError } from "../utils/reports.ts";
import { truncate, withTimeout } from "../utils/utils.ts";
import { isAllowed } from "./access.ts";
import { CaptionBuilder } from "./caption-builder.ts";
import { allItemsLink } from "./deep-link.ts";
import {
  answerWithHint,
  type ChosenResultContext,
  inlineErrorReason,
  type InlineQueryContext,
  originalPostKeyboard,
  parseUrl,
} from "./inline-utils.ts";
import { uploadApi } from "./upload-api.ts";
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
 * Result IDs are "item:<index of the file in the post>"
 */
const ITEM_RESULT_PREFIX = "item:";

/**
 * Telegram does not document how long it waits for the answer; reports put it
 * near 10 s. A post usually arrives in 1–3 s.
 */
const FETCH_BUDGET_MS = 4_000;

/**
 * Telegram takes at most 50 results in one answer
 */
const MAX_RESULTS = 50;

/**
 * The post that answers an inline query also serves the chosen result, so the
 * platform gets one request instead of two. The download links of a post stay
 * valid much longer than an entry lives here.
 */
const RECENT_POST_MS = 5 * 60_000;
const recentPosts = new Map<string, Promise<FilePost>>();

/**
 * Inline mode lets the user tag the bot in any chat, including a private chat
 * that the bot is not a member of. Telegram delivers the tagged text without
 * entities, and it expects an answer within a few seconds. Therefore the bot
 * answers with a placeholder message and downloads the media only after the
 * user picks the result.
 *
 * An inline message holds one media item, so a post with more items gets one
 * result per item. When the post is too slow to arrive, a single result
 * stands for the first item instead.
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

  const post = await withTimeout(fetchPost(url, client), FETCH_BUDGET_MS);
  if (post?.type === "multi" && post.files.length > 1) {
    await answerWithItems(ctx, url, post);
    return;
  }

  await ctx.answerInlineQuery([{
    type: "article",
    id: `${ITEM_RESULT_PREFIX}0`,
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
  const index = itemIndex(ctx.chosenInlineResult.result_id);

  try {
    const post = await fetchPost(url, client);
    const uploaded = await uploadToStorage(ctx, client, pickFile(post, index));
    const caption = CaptionBuilder.inline(post, index);

    await ctx.api.editMessageMediaInline(
      inlineMessageId,
      buildInputMedia(uploaded, caption),
      { reply_markup: await deliveredKeyboard(ctx, url, post) },
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

async function answerWithItems(
  ctx: InlineQueryContext,
  url: URL,
  post: MultiFilePost,
) {
  const description = truncate(
    post.title || post.description || url.toString(),
    100,
  );

  const results = post.files.slice(0, MAX_RESULTS).map((file, index) =>
    ({
      type: "article",
      id: `${ITEM_RESULT_PREFIX}${index}`,
      title: messages.INLINE_ITEM_TITLE(
        file.type,
        index + 1,
        post.files.length,
      ),
      description,
      thumbnail_url: file.type === "photo" ? file.downloadUrl : undefined,
      input_message_content: { message_text: messages.INLINE_DOWNLOADING },
      // Without an inline keyboard, Telegram does not report the ID of the
      // sent message, and the bot cannot replace the placeholder
      reply_markup: originalPostKeyboard(url),
    }) satisfies InlineQueryResultArticle
  );

  const options = { cache_time: 0, is_personal: true };

  try {
    await ctx.answerInlineQuery(results, options);
  } catch (e) {
    if (!(e instanceof GrammyError) || e.error_code !== 400) throw e;

    // The thumbnails are links to the platform, which Telegram can refuse.
    // The results still work without them.
    log.error("Inline results with thumbnails were refused", e);
    await ctx.answerInlineQuery(
      results.map(({ thumbnail_url: _, ...it }) => it),
      options,
    );
  }
}

function fetchPost(url: URL, client: PlatformClient): Promise<FilePost> {
  const key = url.toString();

  let post = recentPosts.get(key);
  if (!post) {
    post = client.fetchPost();
    recentPosts.set(key, post);

    // A failed fetch leaves at once, so that the chosen result tries again
    post.then(
      () => setTimeout(() => recentPosts.delete(key), RECENT_POST_MS),
      () => recentPosts.delete(key),
    );
  }

  return post;
}

function itemIndex(resultId: string): number {
  if (!resultId.startsWith(ITEM_RESULT_PREFIX)) return 0;

  const index = Number(resultId.slice(ITEM_RESULT_PREFIX.length));
  return Number.isInteger(index) && index >= 0 ? index : 0;
}

function pickFile(post: FilePost, index: number): SingleMediaFile {
  if (post.type === "single") return post.file;

  const file = post.files[index];
  if (!file) {
    throw Error(`The post has no item ${index + 1}`, {
      cause: { count: post.files.length },
    });
  }

  return file;
}

/**
 * A failure to store the link only costs the "all items" button, so the item
 * still goes out
 */
async function deliveredKeyboard(
  ctx: ChosenResultContext,
  url: URL,
  post: FilePost,
): Promise<InlineKeyboard> {
  const keyboard = originalPostKeyboard(url);
  if (post.type === "single" || post.files.length < 2) return keyboard;

  try {
    const link = await allItemsLink(ctx.me.username, url);
    keyboard.url(messages.INLINE_ALL_ITEMS(post.files.length), link);
  } catch (e) {
    log.error("Failed to store the link of the post", e);
  }

  return keyboard;
}

/**
 * An inline message cannot carry a freshly uploaded file, so the media first
 * goes to a storage chat, which gives us a reusable file ID.
 */
async function uploadToStorage(
  ctx: ChosenResultContext,
  client: PlatformClient,
  file: SingleMediaFile,
): Promise<UploadedMedia> {
  const stream = await client.getByteStream(file.downloadUrl);
  const chatId = config.INLINE_STORAGE_CHAT || ctx.chosenInlineResult.from.id;
  const inputFile = new InputFile(stream);
  const other = { disable_notification: true };

  let message: Message;
  switch (file.type) {
    case "video":
      message = await uploadApi.sendVideo(chatId, inputFile, other);
      break;
    case "photo":
      message = await uploadApi.sendPhoto(chatId, inputFile, other);
      break;
    case "animation":
      message = await uploadApi.sendAnimation(chatId, inputFile, other);
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
