import { type CallbackQueryContext, InputFile } from "grammy";
import { YouTubeClient } from "../client/youtube-client.ts";
import type { DinoContext } from "./dinogram.ts";
import { log } from "../core/log.ts";
import { config } from "../core/config.ts";
import { ReplyParameters } from "@grammyjs/types";

type CommonCallbackData = {
  type: string;
  videoId: string;
  quality: string;
};

export type YoutubeCallbackData = CommonCallbackData & {
  type: "youtube";
};

type DinoCallbackData = YoutubeCallbackData;

export async function youtubeCallback(ctx: CallbackQueryContext<DinoContext>) {
  await ctx.answerCallbackQuery(); // TODO: Provide some kind of message

  const { message } = ctx.callbackQuery;
  if (!message) {
    throw new Error("Invalid state: Message is undefined");
  }

  const data = decodeCallbackData(ctx.callbackQuery.data);
  if (data.type !== "youtube") {
    throw new Error(
      `Invalid callback type. Expected: 'youtube'. Actual: '${data.type}'`,
    );
  }

  log.debug("YouTube callback received: " + ctx.callbackQuery.data);

  const url = YouTubeClient.urlFromId(data.videoId);
  const youtubeClient = new YouTubeClient(url);

  const videoStream = await youtubeClient.getVideoStream(data.quality);
  const inputFile = new InputFile(videoStream);

  const replyParameters = config.SEND_AS_REPLY
    ? {
      message_id: message.message_id,
      allow_sending_without_reply: true,
    } satisfies ReplyParameters
    : undefined;

  const sentMessage = await ctx.api.sendVideo(
    message.chat.id,
    inputFile,
    {
      reply_parameters: replyParameters,
      message_thread_id: message?.message_thread_id,
    },
  );

  await ctx.api.deleteMessage(message.chat.id, message.message_id);

  log.debug(`Sent YouTube video. Message ID: ${sentMessage.message_id}`);
}

export function encodeCallbackData(data: DinoCallbackData): string {
  const encoded = [data.type, data.videoId, data.quality].join("|");

  if (encoded.length > 64) {
    throw new Error(`Encoded callback data exceeds 64 bytes: ${encoded}`);
  }

  return encoded;
}

export function decodeCallbackData(data: string): DinoCallbackData {
  const segments = data.split("|");
  return {
    type: segments[0] as DinoCallbackData["type"],
    videoId: segments[1],
    quality: segments[2],
  };
}
