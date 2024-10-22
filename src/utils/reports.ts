import { bold, fmt, pre, Stringable } from "@grammyjs/parse-mode";
import { Context } from "grammy";
import { config } from "../core/config.ts";
import { log } from "../core/log.ts";
import { truncate } from "./utils.ts";

export async function reportError(
  ctx: Context,
  error: string,
  cause?: Error,
) {
  const message = ctx.message?.text;

  const errorDetails = {
    cause: cause?.message,
    message,
  };

  log.error(error, errorDetails);

  const parts: Stringable[] = [];
  parts.push(bold(truncate(error, 90)));

  if (config.SEND_ERRORS) {
    if (cause) {
      const jsonString = JSON.stringify(
        errorDetails,
        Object.getOwnPropertyNames(errorDetails),
        2,
      );
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
