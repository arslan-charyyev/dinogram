import { bold, fmt } from "@grammyjs/parse-mode";
import type {
  InputMediaPhoto,
  InputMediaVideo,
  Message,
  ReplyParameters,
} from "@grammyjs/types";
import { Context, InputFile } from "grammy";
import { PlatformClient } from "../platforms/platform-client.ts";
import { config } from "../core/config.ts";
import { AudioFile } from "../model/file.ts";
import { FilePost, MultiFilePost, SingleFilePost } from "../model/post.ts";
import { replyWithError } from "../core/error-handling.ts";
import { CaptionBuilder } from "./caption-builder.ts";
import { ClientFactory } from "../platforms/client-factory.ts";
import { logger } from "../core/logging.ts";

export class UrlHandler {
  constructor(
    private ctx: Context,
    private message: Message,
    private url: URL,
  ) {}

  async handle() {
    const client = ClientFactory.find(this.url);
    if (!client) return;

    let post: FilePost;
    try {
      post = await client.fetchPost();
    } catch (e) {
      await replyWithError(
        this.ctx,
        "Error fetching post details",
        e instanceof Error ? e : undefined,
      );
      return;
    }

    switch (post.type) {
      case "single":
        return await this.replyWithSingleMedia(post, client);
      case "multi":
        return await this.replyWithMediaGroup(post, client);
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
      await replyWithError(
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

    logger.info`Sent ${post.file.type}. message_id: ${sentMessage.message_id}`;
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
        logger.info`Sent ${client.name} media group. IDs: ${messageIds}`;

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

        logger.info`Sent ${client.name} ${type}. ID: ${sentMessage.message_id}`;

        lastSentMessageId = sentMessage.message_id;
      }

      batchIndex++;
    }

    if (post.audio) {
      this.replyWithAudio(post.audio, lastSentMessageId);
    }
  }

  private async replyWithAudio(
    file: AudioFile,
    lastSentMessageId: number | undefined,
  ) {
    const audioRes = await fetch(file.downloadUrl);

    if (!audioRes.body) {
      await replyWithError(
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
}
