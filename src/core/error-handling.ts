import { bold, fmt, pre, Stringable } from "@grammyjs/parse-mode";
import { Context } from "grammy";
import { config } from "./config.ts";
import { log } from "./log.ts";
import { truncate } from "./utils.ts";
import { RetryError } from "@std/async";
import { ZodError } from "zod";

export async function replyWithError(
  ctx: Context,
  error: string,
  cause?: unknown,
) {
  const url = ctx.message?.text;

  // Unwrap cause from retry errors
  if (cause instanceof RetryError && cause.cause instanceof Error) {
    cause = cause.cause;
  }

  const errorDetails = {
    url,
    cause: cause instanceof ZodError
      ? cause.errors
      : cause instanceof Error
      ? cause.message
      : cause,
  };

  log.error(error);
  if (cause) {
    console.error(cause);
  }

  const parts: Stringable[] = [];
  parts.push(bold(truncate(error, 90)));

  if (config.SEND_ERRORS) {
    if (cause) {
      const jsonString = JSON.stringify(errorDetails, null, 2);
      const json = truncate(jsonString, 4000);
      parts.push("\n", pre(json, "json"));
    }

    const errorMessage = fmt(parts);

    // Report the error to original chat
    const chatReply = ctx.reply(errorMessage.text, {
      entities: errorMessage.entities,
      reply_parameters: ctx.message
        ? { message_id: ctx.message.message_id }
        : undefined,
    });

    // Report the error to all intended recipients
    const configReport = config.REPORT_ERRORS_TO.map((id) =>
      ctx.api.sendMessage(
        id,
        errorMessage.text,
        { entities: errorMessage.entities },
      )
    );

    await Promise.all([
      chatReply,
      ...configReport,
    ]);
  }
}
