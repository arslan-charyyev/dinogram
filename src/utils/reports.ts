import {
  bold,
  fmt,
  FormattedString,
  pre,
  Stringable,
} from "@grammyjs/parse-mode";
import { RetryError } from "@std/async";
import { Context } from "grammy";
import { ZodError } from "zod";
import { config } from "../core/config.ts";
import { log } from "../core/log.ts";
import { truncate } from "./utils.ts";

export async function reportError(
  ctx: Context,
  reason: string,
  error?: unknown,
) {
  error = unwrapCause(error);

  log.error(`Replying with ${reason}: ${error}`);

  if (!config.SEND_ERRORS) return;

  const errorMessage = formatError(reason, error, true);

  const reports: Promise<unknown>[] = [];

  // Inline requests carry no chat, so there is nothing to reply to
  if (ctx.chat) {
    reports.push(ctx.reply(errorMessage.text, {
      entities: errorMessage.entities,
      reply_parameters: ctx.message
        ? { message_id: ctx.message.message_id }
        : undefined,
    }));
  }

  reports.push(...reportToRecipients(ctx, errorMessage));

  await Promise.all(reports);
}

/**
 * An inline message shows a placeholder until the media replaces it, so a
 * failure must replace that placeholder even when `SEND_ERRORS` is off.
 * Only the error details obey that setting.
 */
export async function reportInlineError(
  ctx: Context,
  inlineMessageId: string,
  reason: string,
  error?: unknown,
) {
  error = unwrapCause(error);

  log.error(`Replying with ${reason}: ${error}`);

  const errorMessage = formatError(reason, error, config.SEND_ERRORS);

  const reports: Promise<unknown>[] = [
    ctx.api.editMessageTextInline(inlineMessageId, errorMessage.text, {
      entities: errorMessage.entities,
    }),
    ...reportToRecipients(ctx, errorMessage),
  ];

  await Promise.all(reports);
}

function reportToRecipients(ctx: Context, message: FormattedString) {
  if (!config.SEND_ERRORS) return [];

  return config.REPORT_ERRORS_TO.map((id) =>
    ctx.api.sendMessage(id, message.text, { entities: message.entities })
  );
}

function formatError(
  reason: string,
  error: unknown,
  withDetails: boolean,
): FormattedString {
  const parts: Stringable[] = [bold(truncate(reason, 90))];

  if (withDetails) {
    const errorDetails = {
      cause: error instanceof ZodError
        ? error.issues
        : error instanceof Error
        ? { message: error.message, cause: error.cause }
        : error,
    };

    const jsonString = JSON.stringify(errorDetails, null, 2);
    parts.push("\n", pre(truncate(jsonString, 4000), "json"));
  }

  return fmt(parts);
}

function unwrapCause(error: unknown): unknown {
  return error instanceof RetryError ? error.cause : error;
}
