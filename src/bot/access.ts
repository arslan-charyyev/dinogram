import type { CommandContext, Context } from "grammy";
import type { Chat, Message, User } from "@grammyjs/types";
import { config } from "../core/config.ts";
import { db } from "../core/db.ts";
import { log } from "../core/log.ts";
import { messages } from "../core/messages.ts";

type Target = {
  id: number;
  label?: string;
};

export function isAdmin(userId: number | undefined): boolean {
  return userId !== undefined && config.BOT_ADMINS.includes(userId);
}

/**
 * Decides who may use the bot. An admin always passes. Everyone else needs an
 * entry, either in the static {@link config.WHITELIST} of the deployment, or in
 * the dynamic list that the admins manage in chat.
 *
 * A chat ID passes for every member of that chat, which is how a whole group
 * gets access.
 */
export async function isAllowed(
  userId: number,
  chatId?: number,
): Promise<boolean> {
  // Nobody owns the bot and no list names anyone, so it serves everyone, the
  // way it behaved before the dynamic whitelist existed
  if (config.BOT_ADMINS.length === 0 && config.WHITELIST.length === 0) {
    return true;
  }

  if (isAdmin(userId)) return true;

  for (const id of [userId, chatId]) {
    if (id === undefined) continue;

    if (config.WHITELIST.includes(id)) return true;
    if (await db.whitelist.has(id)) return true;
  }

  log.info(`Refused user ${userId} in chat ${chatId}`);

  return false;
}

export async function allow(ctx: CommandContext<Context>) {
  const adminId = await adminIdOf(ctx);
  if (adminId === undefined) return;

  const targets = await targetsOf(ctx);
  if (targets === undefined) return;

  const lines: string[] = [];
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
        ? messages.ALLOW_ADDED(describe(target))
        : messages.ALLOW_ALREADY(describe(target)),
    );
  }

  await ctx.reply(lines.join("\n"));
}

export async function deny(ctx: CommandContext<Context>) {
  const adminId = await adminIdOf(ctx);
  if (adminId === undefined) return;

  const targets = await targetsOf(ctx);
  if (targets === undefined) return;

  const lines: string[] = [];
  for (const target of targets) {
    const removed = await db.whitelist.remove(target.id);

    log.info(`Admin ${adminId} denied ${target.id}`);
    lines.push(
      removed
        ? messages.DENY_REMOVED(describe(target))
        : messages.DENY_MISSING(describe(target)),
    );
  }

  await ctx.reply(lines.join("\n"));
}

export async function listAllowed(ctx: CommandContext<Context>) {
  if (await adminIdOf(ctx) === undefined) return;

  const entries = await db.whitelist.list();

  await ctx.reply(messages.ALLOWED_LIST(
    config.BOT_ADMINS,
    config.WHITELIST,
    entries.map(describe),
  ));
}

/**
 * Answers the sender and returns undefined when the sender is no admin
 */
async function adminIdOf(
  ctx: CommandContext<Context>,
): Promise<number | undefined> {
  const userId = ctx.from?.id;
  if (isAdmin(userId)) return userId;

  await ctx.reply(messages.NOT_ADMIN);
  return undefined;
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
      targets.push({ id, label: await lookUpLabel(ctx, id) });
    }
    return targets;
  }

  const repliedTo = replyTarget(ctx.message);
  if (repliedTo) return [{ id: repliedTo.id, label: userLabel(repliedTo) }];

  return [{ id: ctx.chat.id, label: chatLabel(ctx.chat) }];
}

/**
 * An ID alone says nothing in a list, so the bot asks Telegram for a name.
 * Telegram knows a chat only after the bot has met it, thus a name is optional.
 */
async function lookUpLabel(
  ctx: CommandContext<Context>,
  id: number,
): Promise<string | undefined> {
  try {
    return chatLabel(await ctx.api.getChat(id));
  } catch (e) {
    log.debug(`Telegram knows no chat ${id}`, e);
    return undefined;
  }
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

function describe(target: Target): string {
  return target.label ? `${target.id} — ${target.label}` : `${target.id}`;
}

function chatLabel(chat: Chat): string | undefined {
  if ("title" in chat) return chat.title;

  if ("first_name" in chat) {
    return userLabel({
      first_name: chat.first_name,
      last_name: "last_name" in chat ? chat.last_name : undefined,
      username: "username" in chat ? chat.username : undefined,
    });
  }

  return undefined;
}

function userLabel(
  user: Pick<User, "first_name" | "last_name" | "username">,
): string | undefined {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  if (name && user.username) return `${name} (@${user.username})`;
  if (name) return name;

  return user.username ? `@${user.username}` : undefined;
}
