import type { BotCommand } from "@grammyjs/types";
import type { CommandContext, Context } from "grammy";

export type CommandHandler = (ctx: CommandContext<Context>) => unknown;

/**
 * One chat command. The same entry registers the handler and fills the command
 * menu, so the two cannot drift apart.
 */
export type CommandSpec = {
  readonly command: string;
  /**
   * The text beside the command in the menu
   */
  readonly description: string;
  /**
   * Only an admin runs the command, and only an admin sees it in the menu
   */
  readonly adminOnly: boolean;
  readonly handler: CommandHandler;
};

export function menuOf(
  specs: readonly CommandSpec[],
  audience: "everyone" | "admins",
): BotCommand[] {
  return specs
    .filter((it) => audience === "admins" || !it.adminOnly)
    .map(({ command, description }) => ({ command, description }));
}
