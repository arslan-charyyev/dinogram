import { bold, fmt, pre, Stringable } from "@grammyjs/parse-mode";
import { Context } from "grammy";
import { config } from "../core/config.ts";
import { log } from "../core/log.ts";
import { truncate } from "./utils.ts";
import { RetryError } from "@std/async";
import { ZodError } from "zod";

export async function reportError(
  ctx: Context,
  reason: string,
  error?: unknown,
) {
  // Unwrap cause from retry errors
  if (error instanceof RetryError) {
    error = error.cause;
  }

  const errorDetails = {
    cause: error instanceof ZodError
      ? error.issues
      : error instanceof Error
      ? { message: error.message, cause: error.cause }
      : error,
  };

  log.error(`Replying with ${reason}: ${error}`);

  const parts: Stringable[] = [];
  parts.push(bold(truncate(reason, 90)));

  if (config.SEND_ERRORS) {
    const jsonString = JSON.stringify(errorDetails, null, 2);
    const json = truncate(jsonString, 4000);
    parts.push("\n", pre(json, "json"));

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
