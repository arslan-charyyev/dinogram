import { Menu, MenuFlavor } from "@grammyjs/menu";
import { DinoContext } from "./dinogram.ts";
import { instagramMenu } from "../platforms/instagram/instagram-menu.ts";

export type DinoMenuContext = DinoContext & MenuFlavor;

export function createConfirmMenu(
  id: string,
  onConfirm: (ctx: DinoMenuContext) => void | Promise<void>,
) {
  return new Menu<DinoContext>(id)
    .text("✅ Confirm", async (ctx) => {
      await onConfirm(ctx);
      ctx.menu.close();
    })
    .back("❌ Cancel");
}

export const menus = {
  settings: new Menu<DinoContext>("settings")
    .submenu("📷 Instagram", "ig"),
};

menus.settings.register(instagramMenu);
