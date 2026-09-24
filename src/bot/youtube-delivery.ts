import { autoRetry } from "@grammyjs/auto-retry";
import type { FormattedString } from "@grammyjs/parse-mode";
import type {
  InputMediaAudio,
  InputMediaVideo,
  Message,
} from "@grammyjs/types";
import { toFileUrl } from "@std/path";
import { Api, GrammyError, type InlineKeyboard, InputFile } from "grammy";
import { YouTubeClient } from "../client/youtube-client.ts";
import { config } from "../core/config.ts";
import { db } from "../core/db.ts";
import { log } from "../core/log.ts";
import { messages } from "../core/messages.ts";
import type { YouTubeOption, YouTubeVideo } from "../model/youtube.ts";

/**
 * A 2000 MB upload through the local Bot API server can take many minutes,
 * because the server passes the file on to Telegram before it answers. The
 * default client of the bot gives up after 500 s. A network error or a
 * timeout is not retried, because the retry would upload the file again.
 */
const uploadApi = new Api(config.BOT_TOKEN, {
  apiRoot: config.BOT_API_ROOT || undefined,
  timeoutSeconds: 60 * 60,
});
uploadApi.config.use(
  autoRetry({ maxRetryAttempts: 3, rethrowHttpErrors: true }),
);

/**
 * A status edit that Telegram delays with a flood wait is worth nothing, and
 * the final edit waits for it. So a status edit gives up instead of waiting.
 */
export const statusApi = new Api(config.BOT_TOKEN, {
  apiRoot: config.BOT_API_ROOT || undefined,
});
statusApi.config.use(
  autoRetry({
    maxRetryAttempts: 1,
    maxDelaySeconds: 5,
    rethrowHttpErrors: true,
  }),
);

const STATUS_INTERVAL_MS = 3_000;

/**
 * Users whose YouTube download runs, from a menu or from inline mode. One
 * download per user keeps a single user from filling the queue.
 */
export const busyUsers = new Set<number>();

export type DeliveryTarget =
  /** A message of the bot, which turns into the file */
  | {
    readonly type: "message";
    readonly chatId: number;
    readonly messageId: number;
    readonly threadId?: number;
  }
  /** An inline message, which cannot carry a fresh upload */
  | {
    readonly type: "inline";
    readonly inlineMessageId: string;
    readonly storageChatId: number;
    readonly keyboard: InlineKeyboard;
  };

export type StatusUpdater = {
  /**
   * Shows the text at most once per interval, unless forced
   */
  readonly update: (text: string, force?: boolean) => void;
  /**
   * Waits until the edits in progress are done, so that a late status edit
   * cannot overwrite the caption of the file
   */
  readonly idle: () => Promise<void>;
};

/**
 * Serializes the status edits of one message and drops the ones that come too
 * fast: Telegram allows about one edit per second in a chat.
 */
export function statusUpdater(
  edit: (text: string) => Promise<unknown>,
): StatusUpdater {
  let lastText = "";
  let lastAt = 0;
  let next: string | undefined;
  let pending: Promise<void> | undefined;

  const flush = () => {
    if (next === undefined) return;

    const text = next;
    next = undefined;
    lastText = text;
    lastAt = Date.now();

    pending = edit(text)
      .then(
        () => {},
        (e) => {
          log.debug(`Status edit failed: ${e}`);
        },
      )
      .finally(() => {
        pending = undefined;
        flush();
      });
  };

  return {
    update(text, force = false) {
      if (text === lastText) return;
      if (!force && Date.now() - lastAt < STATUS_INTERVAL_MS) return;

      next = text;
      if (!pending) flush();
    },
    async idle() {
      while (pending) await pending;
    },
  };
}

/**
 * Turns the target into the file of the option. A file that Telegram already
 * holds goes out by its ID; any other file is downloaded first.
 */
export async function deliver(
  video: YouTubeVideo,
  option: YouTubeOption,
  target: DeliveryTarget,
  caption: FormattedString,
  status: StatusUpdater,
): Promise<void> {
  const cacheKey = [video.id, option.formatId];

  const cached = await db.youtube.file.get(cacheKey);
  if (cached?.kind === option.kind) {
    try {
      await place(video, option, target, caption, { fileId: cached.fileId });
      log.debug(`Sent the cached YouTube ${option.kind} of ${video.id}`);
      return;
    } catch (e) {
      if (!isInvalidFileId(e)) throw e;

      log.warn(
        `The cached file of ${video.id} is gone, so it is downloaded again`,
      );
      await db.youtube.file.delete(cacheKey);
    }
  }

  status.update(
    YouTubeClient.isDownloadQueueFull
      ? messages.YOUTUBE_QUEUED
      : messages.YOUTUBE_DOWNLOADING(option.label),
    true,
  );

  const file = await YouTubeClient.download(
    video,
    option,
    (fraction) =>
      status.update(
        messages.YOUTUBE_DOWNLOADING(
          option.label,
          fraction === undefined ? undefined : Math.floor(fraction * 100),
        ),
      ),
  );

  try {
    status.update(messages.YOUTUBE_UPLOADING, true);
    await status.idle();

    const fileId = await place(video, option, target, caption, {
      // The Bot API server reads a path only in --local mode, and only when it
      // sees the same path, which a shared volume gives
      media: config.UPLOAD_BY_PATH
        ? toFileUrl(file.path).href
        : new InputFile(file.path),
      thumbnail: await fetchThumbnail(video.id),
    });

    if (fileId) {
      await db.youtube.file.set(cacheKey, { kind: option.kind, fileId });
    }

    log.debug(
      `Sent the YouTube ${option.kind} ${option.formatId} of ${video.id}`,
    );
  } finally {
    await file.cleanup();
  }
}

type Source =
  | { readonly fileId: string }
  | { readonly media: string | InputFile; readonly thumbnail?: InputFile };

/**
 * Returns the file ID of the sent file
 */
async function place(
  video: YouTubeVideo,
  option: YouTubeOption,
  target: DeliveryTarget,
  caption: FormattedString,
  source: Source,
): Promise<string | undefined> {
  switch (target.type) {
    case "message": {
      const input = inputMedia(video, option, caption, source);

      let message: Message;
      try {
        // The message is not inline, so Telegram returns the edited message
        message = await uploadApi.editMessageMedia(
          target.chatId,
          target.messageId,
          input,
        ) as Message;
      } catch (e) {
        if (!(e instanceof GrammyError) || isInvalidFileId(e)) throw e;

        // The menu is gone, or Telegram refused to turn it into the file.
        // A new message still delivers the file.
        log.warn(`Could not turn the message into the file: ${e.description}`);
        message = await send(target.chatId, input, {
          message_thread_id: target.threadId,
        });
        await uploadApi.deleteMessage(target.chatId, target.messageId)
          .catch((e) => log.debug(`Could not delete the old message: ${e}`));
      }

      return fileIdOf(message);
    }

    case "inline": {
      let fileId = "fileId" in source ? source.fileId : undefined;

      if (!fileId) {
        // An inline message cannot carry a fresh upload, so the file first goes
        // to the storage chat, which gives a reusable file ID
        const stored = await send(
          target.storageChatId,
          inputMedia(video, option, caption, source),
          { disable_notification: true },
        );

        fileId = fileIdOf(stored);
        await uploadApi.deleteMessage(target.storageChatId, stored.message_id)
          .catch((e) =>
            log.error("Failed to delete the storage chat message", e)
          );

        if (!fileId) {
          throw Error("Storage chat message carries no file", {
            cause: stored,
          });
        }
      }

      await uploadApi.editMessageMediaInline(
        target.inlineMessageId,
        inputMedia(video, option, caption, { fileId }),
        { reply_markup: target.keyboard },
      );

      return fileId;
    }
  }
}

function inputMedia(
  video: YouTubeVideo,
  option: YouTubeOption,
  caption: FormattedString,
  source: Source,
): InputMediaVideo<InputFile> | InputMediaAudio<InputFile> {
  const common = {
    media: "fileId" in source ? source.fileId : source.media,
    thumbnail: "fileId" in source ? undefined : source.thumbnail,
    caption: caption.text,
    caption_entities: caption.entities,
    duration: video.duration,
  };

  // Telegram fills these in by itself only for files under about 10 MB
  return option.kind === "video"
    ? {
      type: "video",
      ...common,
      width: option.width,
      height: option.height,
      supports_streaming: true,
      show_caption_above_media: config.SHOW_CAPTION_ABOVE_MEDIA,
    }
    : {
      type: "audio",
      ...common,
      title: video.title,
      performer: video.channel,
    };
}

function send(
  chatId: number,
  input: InputMediaVideo<InputFile> | InputMediaAudio<InputFile>,
  other: { message_thread_id?: number; disable_notification?: boolean },
): Promise<Message> {
  const { type: _, media, ...rest } = input;

  return input.type === "video"
    ? uploadApi.sendVideo(chatId, media, { ...rest, ...other })
    : uploadApi.sendAudio(chatId, media, { ...rest, ...other });
}

function fileIdOf(message: Message): string | undefined {
  return message.video?.file_id ?? message.audio?.file_id ??
    message.document?.file_id ?? message.animation?.file_id;
}

function isInvalidFileId(error: unknown): boolean {
  return error instanceof GrammyError && error.error_code === 400 &&
    /file_id|file identifier|file reference/i.test(error.description);
}

async function fetchThumbnail(id: string): Promise<InputFile | undefined> {
  try {
    const response = await fetch(YouTubeClient.thumbnailUrl(id, "mq"), {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return undefined;

    const bytes = new Uint8Array(await response.arrayBuffer());
    return new InputFile(bytes, "thumbnail.jpg");
  } catch (e) {
    log.debug(`No thumbnail for ${id}: ${e}`);
    return undefined;
  }
}
