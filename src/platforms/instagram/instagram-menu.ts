import { AsyncValue } from "@core/asyncutil/async-value";
import { Menu } from "@grammyjs/menu";
import {
  bold,
  expandableBlockquote,
  fmt,
  italic,
  link,
  pre,
} from "@grammyjs/parse-mode";
import { Message } from "@grammyjs/types";
import type { DinoContext } from "../../bot/dinogram.ts";
import { createConfirmMenu, DinoMenuContext } from "../../bot/menus.ts";
import { safeRun } from "../../core/utils.ts";
import { AuthMode } from "../../model/auth-mode.ts";
import {
  getInstagramAuthMode,
  setInstagramAuthMode,
} from "./instagram-auth-mode.ts";
import {
  clearInstagramLoginData,
  getInstagramLoginCookies,
  startInstagramBrowserLoginFlow,
} from "./instagram-login.ts";

const callbacks = {
  viewAuthMode: async (ctx: DinoMenuContext) => {
    await safeRun(ctx, "Instagram view auth mode", async () => {
      ctx.menu.close();

      const currentMode = await getInstagramAuthMode();

      ctx.reply(
        "🛂 Select Instagram authentication mode\n\n" +
          `Current mode: ${currentMode}\n\n` +
          "New mode:",
        {
          reply_markup: selectAuthModeMenu,
        },
      );
    });
  },
  setAuthMode: async (ctx: DinoMenuContext) => {
    await safeRun(ctx, "Instagram set auth mode", async () => {
      ctx.menu.close();

      const payload = ctx.match;
      if (!payload) {
        ctx.reply("Error setting auth mode: no payload");
        return;
      }

      if (!Object.values(AuthMode).includes(payload as AuthMode)) {
        ctx.reply(`Invalid auth mode: ${payload}`);
      }

      const newAuthMode = payload as AuthMode;

      await setInstagramAuthMode(newAuthMode);

      ctx.reply(`New authentication mode: ${newAuthMode}`);
    });
  },
  viewLoginData: async (ctx: DinoMenuContext) => {
    await safeRun(ctx, "Instagram view login data", async () => {
      const cookies = await getInstagramLoginCookies();

      const { text, entities } = fmt([
        "🍪 Instagram login cookies:\n",
        expandableBlockquote(
          pre(JSON.stringify(cookies, null, 2), "json"),
        ),
      ]);

      await ctx.reply(text, { entities });
    });
  },
  login: async (ctx: DinoMenuContext) => {
    await safeRun(ctx, "Instagram login", async () => {
      ctx.menu.close();

      const instructionsMessage = new AsyncValue<Message | null>(null);

      const url = await startInstagramBrowserLoginFlow({
        onSuccess: async () => {
          try {
            const message = await instructionsMessage.get();
            if (message) {
              ctx.api.deleteMessage(message.chat.id, message.message_id);
            }

            ctx.reply("✅ Instagram login success. Login data saved.");
          } catch (_) { /* no-op */ }
        },
        onExpire: () => {
          ctx.reply("⌛ Browser session expired.");
        },
      });

      const loginLink = link(bold("🌐 Click to open"), url.toString());
      const message = await ctx.replyFmt(fmt([
        bold("Login steps:\n\n"),
        fmt`- Open login page: ${loginLink}\n`,
        "- Login to your Instagram account\n",
        "- Go to your account settings page ",
        italic(
          "(you will be redirected there automatically after logging in)\n",
        ),
        "- Close the page when instructed\n",
        "\n\n",
        fmt`⏳ Link will be valid for ${bold("1 hour.")}`,
      ]));
      instructionsMessage.set(message);
    });
  },
  logout: async (ctx: DinoMenuContext) => {
    await safeRun(ctx, "Instagram logout", async () => {
      ctx.menu.close();

      await clearInstagramLoginData();

      await ctx.reply(`Logged out of Instagram`);
    });
  },
};

const selectAuthModeMenu = new Menu<DinoContext>("ig-auth-mode")
  .text(
    { text: "Anonymous", payload: AuthMode.Anonymous },
    callbacks.setAuthMode,
  )
  .row()
  .text(
    { text: "Authenticated", payload: AuthMode.Authenticated },
    callbacks.setAuthMode,
  );

export const instagramMenu = new Menu<DinoContext>("ig")
  .text("🛂 Authentication mode", callbacks.viewAuthMode)
  .row()
  .text("🔑 Login", callbacks.login)
  .submenu("🗑️ Logout", "ig-delete-confirm")
  .row()
  .text("🔍 View login data", callbacks.viewLoginData)
  .row()
  .back("⬅️ Go Back");

instagramMenu.register([
  selectAuthModeMenu,
  createConfirmMenu("ig-delete-confirm", callbacks.logout),
]);
