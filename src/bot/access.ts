import type { FormattedString } from "@grammyjs/parse-mode";
import type { CommandContext, Context } from "grammy";
import type { Message, User } from "@grammyjs/types";
import { config } from "../core/config.ts";
import { db } from "../core/db.ts";
import { log } from "../core/log.ts";
import { messages } from "../core/messages.ts";
import { joinLines } from "../utils/utils.ts";
import {
  chatTarget,
  formatTarget,
  type Target,
  userTarget,
} from "./whitelist-target.ts";

export function isAdmin(userId: number | undefined): boolean {
  return userId !== undefined && config.BOT_ADMINS.includes(userId);
}

/**
 * {@link config.BOT_ADMINS} holds user IDs and chat IDs, so every member of an
 * admin chat acts as an admin there
 */
export function isAdminContext(ctx: Context): boolean {
  return isAdmin(ctx.from?.id) || isAdmin(ctx.chat?.id);
}

/**
 * Decides who may use the bot. An admin always passes. Everyone else needs an
 * entry in the whitelist that the admins manage in chat.
 *
 * A chat ID passes for every member of that chat, which is how a whole group
 * gets access.
 */
export async function isAllowed(
  userId: number,
  chatId?: number,
): Promise<boolean> {
  // Nobody can manage the whitelist without an admin, so the bot serves
  // everyone
  if (config.BOT_ADMINS.length === 0) return true;

  if (isAdmin(userId)) return true;

  for (const id of [userId, chatId]) {
    if (id === undefined) continue;

    if (await db.whitelist.has(id)) return true;
  }

  log.info(`Refused user ${userId} in chat ${chatId}`);

  return false;
}

/**
 * The command registry lets only an admin run this
 */
export async function allow(ctx: CommandContext<Context>) {
  const adminId = ctx.from?.id ?? ctx.chat.id;

  const targets = await targetsOf(ctx);
  if (targets === undefined) return;

  const lines: FormattedString[] = [];
  for (const target of targets) {
    const added = await db.whitelist.add({
      id: target.id,
      label: target.label,
      addedAt: new Date().toISOString(),
      addedBy: adminId,
    });

    log.info(`Admin ${adminId} allowed ${target.id}`);
    lines.push(
      added
        ? messages.ALLOW_ADDED(formatTarget(target))
        : messages.ALLOW_ALREADY(formatTarget(target)),
    );
  }

  await replyFormatted(ctx, joinLines(lines));
}

/**
 * The command registry lets only an admin run this
 */
export async function deny(ctx: CommandContext<Context>) {
  const adminId = ctx.from?.id ?? ctx.chat.id;

  const targets = await targetsOf(ctx);
  if (targets === undefined) return;

  const lines: FormattedString[] = [];
  for (const target of targets) {
    const removed = await db.whitelist.remove(target.id);

    log.info(`Admin ${adminId} denied ${target.id}`);
    lines.push(
      removed
        ? messages.DENY_REMOVED(formatTarget(target))
        : messages.DENY_MISSING(formatTarget(target)),
    );
  }

  await replyFormatted(ctx, joinLines(lines));
}

/**
 * The command registry lets only an admin run this. The bot asks Telegram for
 * every name again, so the list shows the current names, and marks a chat that
 * the bot cannot see any more.
 */
export async function listAllowed(ctx: CommandContext<Context>) {
  const entries = await db.whitelist.list();

  const [admins, allowed] = await Promise.all([
    Promise.all(config.BOT_ADMINS.map((id) => lookUp(ctx, id))),
    Promise.all(entries.map(async (entry) => {
      const target = await lookUp(ctx, entry.id);
      return { ...target, label: target.label ?? entry.label };
    })),
  ]);

  await replyFormatted(
    ctx,
    messages.ALLOWED_LIST(admins.map(formatTarget), allowed.map(formatTarget)),
  );
}

/**
 * Reads the IDs that the command acts on: the arguments, the author of the
 * replied-to message, or the current chat. Answers the sender and returns
 * undefined when an argument is no ID.
 */
async function targetsOf(
  ctx: CommandContext<Context>,
): Promise<Target[] | undefined> {
  const args = ctx.match.trim().split(/\s+/).filter(Boolean);

  if (args.length > 0) {
    const targets: Target[] = [];
    for (const arg of args) {
      const id = Number(arg);
      if (!Number.isSafeInteger(id)) {
        await ctx.reply(messages.NOT_AN_ID(arg));
        return undefined;
      }
      targets.push(await lookUp(ctx, id));
    }
    return targets;
  }

  const repliedTo = replyTarget(ctx.message);
  if (repliedTo) return [userTarget(repliedTo)];

  return [chatTarget(ctx.chat)];
}

/**
 * An ID alone says nothing in a list, so the bot asks Telegram for a name.
 * Telegram knows a chat only after the bot has met it, thus a name is optional.
 */
async function lookUp(
  ctx: CommandContext<Context>,
  id: number,
): Promise<Target> {
  try {
    const chat = await ctx.api.getChat(id);
    const inPrivate = ctx.chat.type === "private";
    return { ...chatTarget(chat, inPrivate), reachable: true };
  } catch (e) {
    log.debug(`Telegram knows no chat ${id}`, e);
    return { id, reachable: false };
  }
}

/**
 * A list of links would otherwise unfold one preview per link
 */
async function replyFormatted(ctx: Context, text: FormattedString) {
  await ctx.reply(text.text, {
    entities: text.entities,
    link_preview_options: { is_disabled: true },
  });
}

/**
 * The author of the replied-to message, when the sender really replied to one.
 * In a forum topic, Telegram fills reply_to_message with the service message
 * that opened the topic, and that message names the wrong person.
 */
function replyTarget(message: Message | undefined): User | undefined {
  const repliedTo = message?.reply_to_message;
  if (!repliedTo || repliedTo.forum_topic_created) return undefined;

  return repliedTo.from;
}
