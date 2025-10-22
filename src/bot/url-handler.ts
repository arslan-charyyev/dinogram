import { blockquote, bold, fmt, pre } from "@grammyjs/parse-mode";
import type {
  InputMediaPhoto,
  InputMediaVideo,
  Message,
  ReplyParameters,
} from "@grammyjs/types";
import { Context, InlineKeyboard, InputFile } from "grammy";
import type { PlatformClient } from "../client/platform-client.ts";
import { config } from "../core/config.ts";
import { log } from "../core/log.ts";
import { AudioFile } from "../model/file.ts";
import {
  FilePost,
  MultiFilePost,
  MultiQualityVideoPost,
  SingleFilePost,
} from "../model/post.ts";
import { reportError } from "../utils/reports.ts";
import { CaptionBuilder } from "./caption-builder.ts";
import { encodeCallbackData, YoutubeCallbackData } from "./callbacks.ts";
import { messages } from "../core/messages.ts";

export class UrlHandler {
  constructor(
    private ctx: Context,
    private message: Message,
  ) {}

  async handle(client: PlatformClient) {
    let post: FilePost;
    try {
      post = await client.fetchPost();
    } catch (e) {
      await reportError(
        this.ctx,
        "Error fetching post details",
        e instanceof Error ? e : undefined,
      );
      return;
    }

    switch (post.type) {
      case "single-file":
        return await this.replyWithSingleMedia(post, client);
      case "multi-file":
        return await this.replyWithMediaGroup(post, client);
      case "multi-quality-video":
        return await this.replyWithQualityOptions(post, client);
    }
  }

  private async replyWithSingleMedia(
    post: SingleFilePost,
    client: PlatformClient,
  ) {
    let stream: ReadableStream<Uint8Array>;
    try {
      stream = await client.getByteStream(post.file.downloadUrl);
    } catch (e) {
      await reportError(
        this.ctx,
        `Could not get ${post.file.type} stream`,
        e instanceof Error ? e : undefined,
      );
      return;
    }

    const caption = CaptionBuilder.single(post);

    const replyParameters = config.SEND_AS_REPLY
      ? {
        message_id: this.message.message_id,
        allow_sending_without_reply: true,
        quote: post.pageUrl.toString(),
      } satisfies ReplyParameters
      : undefined;

    const chatId = this.message.chat.id;
    const inputFile = new InputFile(stream);
    const other: Parameters<typeof this.ctx.api.sendVideo>[2] = {
      caption: caption.text,
      caption_entities: caption.entities,
      reply_parameters: replyParameters,
      message_thread_id: this.message.message_thread_id,
    };

    let sentMessage: Message;
    switch (post.file.type) {
      case "video":
        sentMessage = await this.ctx.api.sendVideo(chatId, inputFile, other);
        break;
      case "photo":
        sentMessage = await this.ctx.api.sendPhoto(chatId, inputFile, other);
        break;
    }

    log.debug(`Sent ${post.file.type}. message_id: ${sentMessage.message_id}`);
  }

  private async replyWithMediaGroup(
    post: MultiFilePost,
    client: PlatformClient,
  ) {
    const pageUrl = post.pageUrl.toString();

    let lastSentMessageId: number | undefined = undefined;

    type InputMediaPhotoOrVideo =
      | InputMediaPhoto<InputFile>
      | InputMediaVideo<InputFile>;

    let batchIndex = 0;
    for await (const inputBatch of client.generateStreamBatches(post.files)) {
      const mediaGroup = inputBatch.map<InputMediaPhotoOrVideo>(
        ({ type, stream }, index) => {
          const caption = index == 0
            ? CaptionBuilder.multi(post, batchIndex)
            : undefined;

          return {
            type,
            media: new InputFile(stream),
            caption: caption?.text,
            caption_entities: caption?.entities,
            show_caption_above_media: config.SHOW_CAPTION_ABOVE_MEDIA,
          } satisfies InputMediaPhotoOrVideo;
        },
      );

      const replyParameters = config.SEND_AS_REPLY
        ? {
          message_id: lastSentMessageId ?? this.message.message_id,
          allow_sending_without_reply: true,
          quote: batchIndex == 0 ? pageUrl : undefined,
        } satisfies ReplyParameters
        : undefined;

      const other: Parameters<typeof this.ctx.api.sendMediaGroup>[2] = {
        reply_parameters: replyParameters,
        message_thread_id: this.message.message_thread_id,
      };

      if (mediaGroup.length >= 2) {
        const messages = await this.ctx.api.sendMediaGroup(
          this.message.chat.id,
          mediaGroup,
          other,
        );

        const messageIds = messages.map((it) => it.message_id);
        log.debug(`Sent ${client.name} media group. IDs: ${messageIds}`);

        lastSentMessageId = messages.at(-1)?.message_id;
      } else {
        const { type, media, caption, caption_entities } = mediaGroup[0];

        const chatId = this.message.chat.id;
        const other: Parameters<typeof this.ctx.api.sendVideo>[2] = {
          caption: caption,
          caption_entities: caption_entities,
          reply_parameters: replyParameters,
          message_thread_id: this.message.message_thread_id,
        };

        let sentMessage: Message;
        switch (type) {
          case "video":
            sentMessage = await this.ctx.api.sendVideo(chatId, media, other);
            break;
          case "photo":
            sentMessage = await this.ctx.api.sendPhoto(chatId, media, other);
            break;
        }

        log.debug(`Sent ${client.name} ${type}. ID: ${sentMessage.message_id}`);

        lastSentMessageId = sentMessage.message_id;
      }

      batchIndex++;
    }

    if (post.audio) {
      await this.replyWithAudio(post.audio, lastSentMessageId);
    }
  }

  private async replyWithAudio(
    file: AudioFile,
    lastSentMessageId: number | undefined,
  ) {
    const audioRes = await fetch(file.downloadUrl);

    if (!audioRes.body) {
      await reportError(
        this.ctx,
        "Failed to get audio stream",
        new Error(audioRes.statusText),
      );

      return;
    }

    const audioCaption = fmt([
      bold(file.author),
      "\n" + file.title,
    ]);

    await this.ctx.api.sendAudio(
      this.message.chat.id,
      new InputFile(audioRes.body),
      {
        caption: audioCaption.text,
        caption_entities: audioCaption.entities,
        message_thread_id: this.message.message_thread_id,
        reply_parameters: {
          message_id: lastSentMessageId ?? this.message.message_id,
        },
      },
    );
  }

  private async replyWithQualityOptions(
    post: MultiQualityVideoPost,
    client: PlatformClient,
  ) {
    const replyParameters = config.SEND_AS_REPLY
      ? {
        message_id: this.message.message_id,
        allow_sending_without_reply: true,
        quote: post.pageUrl.toString(),
      } satisfies ReplyParameters
      : undefined;

    const keyboard = new InlineKeyboard();
    for (const quality of post.qualityVariants) {
      const icon = quality.type === "video" ? "📽️" : "🔊";
      const mbSize = (quality.approxByteCount / 1_000_000).toFixed(2);
      const buttonText = `${icon} ${quality.name} ~ ${mbSize}mb`;

      // Embed the quality and the original URL in the callback data
      const callbackData: YoutubeCallbackData = {
        type: "youtube",
        quality: quality.name,
        videoId: post.videoId,
      };

      `${post.videoId}|${quality.name}`;
      keyboard.text(buttonText, encodeCallbackData(callbackData)).row();
    }

    const prompt = fmt([
      blockquote(post.description),
      "\n\n",
      messages.SELECT_QUALITY,
    ]);

    // Send the message with the inline keyboard
    const sentMessage = await this.ctx.api.sendMessage(
      this.message.chat.id,
      prompt.text,
      {
        entities: prompt.entities,
        reply_parameters: replyParameters,
        reply_markup: keyboard,
        message_thread_id: this.message.message_thread_id,
      },
    );

    log.debug(
      `Asking ${client.name} video quality. ID: ${sentMessage.message_id}`,
    );
  }
}
