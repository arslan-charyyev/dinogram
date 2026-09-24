import type { InlineQueryResultArticle } from "@grammyjs/types";
import { YouTubeClient, YouTubeUserError } from "../client/youtube-client.ts";
import { config } from "../core/config.ts";
import { messages } from "../core/messages.ts";
import type {
  YouTubeLink,
  YouTubeOption,
  YouTubeVideo,
} from "../model/youtube.ts";
import { reportInlineError } from "../utils/reports.ts";
import { formatSize, truncate, withTimeout } from "../utils/utils.ts";
import { CaptionBuilder } from "./caption-builder.ts";
import {
  answerWithHint,
  type ChosenResultContext,
  inlineErrorReason,
  type InlineQueryContext,
  originalPostKeyboard,
} from "./inline-utils.ts";
import {
  busyUsers,
  deliver,
  statusApi,
  statusUpdater,
} from "./youtube-delivery.ts";

type YouTubeVideoLink = Extract<YouTubeLink, { type: "video" }>;

/**
 * Result IDs are "yt:<video ID>:<choice>"
 */
export const YOUTUBE_RESULT_PREFIX = "yt:";

/**
 * Telegram does not document how long it waits for the answer; reports put it
 * near 10 s. A probe usually takes 2–3 s, so 4 s leaves room for the answer.
 */
const PROBE_BUDGET_MS = 4_000;

const Choice = {
  /** The best size of a Short */
  SHORT: "s",
  /** A medium video size, when the probe was too slow to list the sizes */
  MEDIUM: "v",
  /** The best audio, when the probe was too slow to list the qualities */
  AUDIO: "a",
};

/**
 * Lists one result per video size and audio quality. When the probe is too
 * slow, it lists a medium video and an audio result instead, and the format
 * is resolved after the user picks one. The probe keeps running, so it is
 * usually done by then.
 */
export async function answerYouTubeInlineQuery(
  ctx: InlineQueryContext,
  link: YouTubeVideoLink,
) {
  const video = link.isShort ? undefined : await withTimeout(
    YouTubeClient.fetchVideo(link.id),
    PROBE_BUDGET_MS,
  );

  const url = new URL(YouTubeClient.watchUrl(link.id));
  const result = (choice: string, title: string, description: string) =>
    ({
      type: "article",
      id: `${YOUTUBE_RESULT_PREFIX}${link.id}:${choice}`,
      title,
      description: truncate(description, 100),
      thumbnail_url: YouTubeClient.thumbnailUrl(link.id, "mq"),
      input_message_content: { message_text: messages.INLINE_DOWNLOADING },
      // Without an inline keyboard, Telegram does not report the ID of the
      // sent message, and the bot cannot replace the placeholder
      reply_markup: originalPostKeyboard(url),
    }) satisfies InlineQueryResultArticle;

  let results: InlineQueryResultArticle[];

  if (link.isShort || video?.isShort) {
    results = [
      result(
        Choice.SHORT,
        messages.YOUTUBE_INLINE_SHORT,
        video?.title ?? url.toString(),
      ),
    ];
  } else if (!video) {
    results = [
      result(Choice.MEDIUM, messages.YOUTUBE_INLINE_MEDIUM, url.toString()),
      result(Choice.AUDIO, messages.YOUTUBE_INLINE_AUDIO, url.toString()),
    ];
  } else {
    results = [
      ...video.videoOptions.map((it) =>
        result(
          it.formatId,
          `🎬 ${it.label} · ${formatSize(it.size)}`,
          video.title,
        )
      ),
      ...video.audioOptions.map((it) =>
        result(
          it.formatId,
          `🎵 ${it.label} · ${formatSize(it.size)}`,
          video.title,
        )
      ),
    ];
  }

  if (results.length === 0) {
    await answerWithHint(ctx, messages.YOUTUBE_NO_OPTIONS);
    return;
  }

  await ctx.answerInlineQuery(results, { cache_time: 0, is_personal: true });
}

export async function handleYouTubeChosenResult(
  ctx: ChosenResultContext,
  inlineMessageId: string,
) {
  const { result_id: resultId, from: user } = ctx.chosenInlineResult;
  const [videoId, choice] = resultId.slice(YOUTUBE_RESULT_PREFIX.length).split(
    ":",
  );

  const url = new URL(YouTubeClient.watchUrl(videoId));
  const keyboard = originalPostKeyboard(url);

  if (busyUsers.has(user.id)) {
    await ctx.api.editMessageTextInline(
      inlineMessageId,
      messages.YOUTUBE_BUSY_USER,
      {
        reply_markup: keyboard,
      },
    );
    return;
  }

  busyUsers.add(user.id);

  const status = statusUpdater((text) =>
    statusApi.editMessageTextInline(inlineMessageId, text, {
      reply_markup: keyboard,
    })
  );

  try {
    const video = await YouTubeClient.fetchVideo(videoId);
    const option = resolveChoice(video, choice);

    if (!option) {
      await ctx.api.editMessageTextInline(
        inlineMessageId,
        messages.YOUTUBE_NO_OPTIONS,
        {
          reply_markup: keyboard,
        },
      );
      return;
    }

    await deliver(
      video,
      option,
      {
        type: "inline",
        inlineMessageId,
        storageChatId: config.INLINE_STORAGE_CHAT || user.id,
        keyboard,
      },
      CaptionBuilder.youtube(video, { inline: true }),
      status,
    );
  } catch (e) {
    await status.idle();
    await reportInlineError(
      ctx,
      inlineMessageId,
      e instanceof YouTubeUserError
        ? e.message
        : inlineErrorReason(e, url.toString()),
      e,
    );
  } finally {
    busyUsers.delete(user.id);
  }
}

function resolveChoice(
  video: YouTubeVideo,
  choice: string,
): YouTubeOption | undefined {
  switch (choice) {
    case Choice.SHORT:
      return video.videoOptions[0];
    case Choice.MEDIUM:
      return video.videoOptions.find((it) =>
        Math.min(it.width ?? 0, it.height ?? 0) <= 720
      ) ?? video.videoOptions.at(-1);
    case Choice.AUDIO:
      return video.audioOptions[0];
    default:
      return [...video.videoOptions, ...video.audioOptions]
        .find((it) => it.formatId === choice);
  }
}
