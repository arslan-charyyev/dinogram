import { CommandMiddleware, Context } from "grammy";
import { config } from "../core/config.ts";
import { menus } from "./menus.ts";

export const commands: Record<string, CommandMiddleware<Context>> = {
  settings: (ctx) => {
    if (config.BOT_ADMINS.includes(ctx.chatId)) {
      return ctx.reply("🛠️ Dinogram settings:", {
        reply_markup: menus.settings,
      });
    }

    return ctx.reply(
      "🚫 You are not authorized to manage Dinogram settings",
    );
  },
};
