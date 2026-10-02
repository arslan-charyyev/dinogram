import type { BotCommand, BotCommandScope } from "@grammyjs/types";
import type { Api, Composer, Context } from "grammy";
import { config, subscriptionsEnabled } from "../core/config.ts";
import { log } from "../core/log.ts";
import { messages } from "../core/messages.ts";
import { allow, deny, isAdminContext, listAllowed } from "./access.ts";
import {
  type CommandHandler,
  type CommandSpec,
  menuOf,
} from "./command-registry.ts";
import { menus } from "./menus.ts";
import {
  handleSubscribeCommand,
  handleSubscriptionsCommand,
} from "./subscription-menu.ts";

/**
 * Every chat command of the bot. The order is the order of the menu.
 */
export const commands: readonly CommandSpec[] = [
  ...(subscriptionsEnabled()
    ? [
      {
        command: "subscribe",
        description: "Follow a YouTube channel",
        adminOnly: false,
        handler: handleSubscribeCommand,
      },
      {
        command: "subscriptions",
        description: "Manage your subscriptions",
        adminOnly: false,
        handler: handleSubscriptionsCommand,
      },
    ]
    : []),
  {
    command: "allow",
    description: "Add a user or a chat to the whitelist",
    adminOnly: true,
    handler: allow,
  },
  {
    command: "deny",
    description: "Remove a user or a chat from the whitelist",
    adminOnly: true,
    handler: deny,
  },
  {
    command: "allowed",
    description: "Show the admins and the whitelist",
    adminOnly: true,
    handler: listAllowed,
  },
  {
    command: "settings",
    description: "Manage the cookies of the bot",
    adminOnly: true,
    handler: (ctx) =>
      ctx.reply("🛠️ Dinogram settings:", { reply_markup: menus.settings }),
  },
];

export function registerCommands<C extends Context>(composer: Composer<C>) {
  for (const spec of commands) {
    composer.command(
      spec.command,
      spec.adminOnly ? adminOnly(spec.handler) : spec.handler,
    );
  }
}

/**
 * The private chats get the commands for everyone. Each admin chat gets every
 * command, because a chat scope takes the place of the private chat scope
 * there.
 */
export async function publishCommandMenus(api: Api) {
  await publishMenu(api, menuOf(commands, "everyone"), {
    type: "all_private_chats",
  });

  for (const chatId of config.BOT_ADMINS) {
    await publishMenu(api, menuOf(commands, "admins"), {
      type: "chat",
      chat_id: chatId,
    });
  }
}

function adminOnly(handler: CommandHandler): CommandHandler {
  return async (ctx) => {
    if (!isAdminContext(ctx)) {
      await ctx.reply(messages.NOT_ADMIN);
      return;
    }

    await handler(ctx);
  };
}

/**
 * Telegram refuses a chat scope for a chat where nobody has started the bot,
 * thus a failure only skips that menu
 */
async function publishMenu(
  api: Api,
  menu: BotCommand[],
  scope: BotCommandScope,
) {
  try {
    // An empty menu clears the commands that an earlier start left there
    if (menu.length > 0) {
      await api.setMyCommands(menu, { scope });
    } else {
      await api.deleteMyCommands({ scope });
    }
  } catch (e) {
    log.error(`Failed to set the command menu for ${JSON.stringify(scope)}`, e);
  }
}
