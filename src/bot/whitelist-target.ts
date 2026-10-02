import {
  fmt,
  type FormattedString,
  link,
  type Stringable,
} from "@grammyjs/parse-mode";
import type { Chat, ChatFullInfo, User } from "@grammyjs/types";

/**
 * A user or a chat that an admin command names
 */
export type Target = {
  readonly id: number;
  readonly label?: string;
  readonly url?: string;
  /**
   * False when Telegram refused to describe the chat to the bot. Undefined
   * when the bot did not ask.
   */
  readonly reachable?: boolean;
};

/**
 * An invite link admits anyone who sees it, so it goes only into a private
 * chat with an admin
 */
export function chatTarget(
  chat: Chat | ChatFullInfo,
  withInviteLink = false,
): Target {
  return {
    id: chat.id,
    label: chatLabel(chat),
    url: chatUrl(chat, withInviteLink),
  };
}

export function userTarget(user: User): Target {
  return { id: user.id, label: userLabel(user), url: userUrl(user) };
}

/**
 * The ID stays in plain text beside the name, because an admin copies it into
 * /deny
 */
export function formatTarget(target: Target): FormattedString {
  const parts: Stringable[] = [`${target.id}`];

  if (target.label) {
    parts.push(
      " — ",
      target.url ? link(target.label, target.url) : target.label,
    );
  }

  // Telegram describes a user only after the user has started the bot, and a
  // group only while the bot is a member
  if (target.reachable === false) parts.push(" ⚠️ not visible to the bot");

  return fmt(parts);
}

/**
 * A private group has no public address, so it gets a link only through its
 * invite link, which Telegram shows to the bot only when the bot is an admin
 */
function chatUrl(
  chat: Chat | ChatFullInfo,
  withInviteLink: boolean,
): string | undefined {
  if ("username" in chat && chat.username) {
    return `https://t.me/${chat.username}`;
  }

  if (chat.type === "private") return userUrl({ id: chat.id });

  if (withInviteLink && "invite_link" in chat && chat.invite_link) {
    return chat.invite_link;
  }

  return undefined;
}

/**
 * A tg:// link opens the profile only when the privacy settings of the user
 * allow it, so a username link comes first
 */
function userUrl(user: Pick<User, "id" | "username">): string {
  return user.username
    ? `https://t.me/${user.username}`
    : `tg://user?id=${user.id}`;
}

function chatLabel(chat: Chat | ChatFullInfo): string | undefined {
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
