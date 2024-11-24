import { Menu, MenuFlavor } from "@grammyjs/menu";
import { fmt, spoiler } from "@grammyjs/parse-mode";
import { db } from "../core/db.ts";
import { dinoConversations } from "./conversations.ts";
import { DinoContext } from "./dinogram.ts";

type DinoMenuContext = DinoContext & MenuFlavor;

const callbacks = {
  instagram: {
    setCookie: async (ctx: DinoMenuContext) => {
      ctx.menu.close();
      await ctx.conversation.enter(dinoConversations.setInstagramCookie.name);
    },
    getCookie: async (ctx: DinoMenuContext) => {
      const cookie = await db.instagram.cookie.get() ?? "null";
      const { text, entities } = fmt([
        "Instagram cookie:\n\n",
        spoiler(cookie),
      ]);
      await ctx.reply(text, { entities });
    },
    deleteCookie: async (ctx: DinoMenuContext) => {
      await db.instagram.cookie.delete();
      await ctx.reply(`Instagram cookie deleted`);
    },
  },
};

const createConfirmMenu = (
  id: string,
  onConfirm: (ctx: DinoMenuContext) => void | Promise<void>,
) =>
  new Menu<DinoContext>(id)
    .text("✅ Confirm", async (ctx) => {
      await onConfirm(ctx);
      ctx.menu.close();
    })
    .back("❌ Cancel");

const instagramMenu = new Menu<DinoContext>("ig")
  .text("📝 Set Cookie", callbacks.instagram.setCookie)
  .text("👓 Get Cookie", callbacks.instagram.getCookie)
  .submenu("🧹 Delete Cookie", "ig-delete-confirm").row()
  .back("⬅️ Go Back");

instagramMenu.register([
  createConfirmMenu("ig-delete-confirm", callbacks.instagram.deleteCookie),
]);

const settingsMenu = new Menu<DinoContext>("settings")
  .submenu("📷 Instagram", "ig");

settingsMenu.register(instagramMenu);

export const menus = {
  settings: settingsMenu,
};
