import type { Conversation } from "@grammyjs/conversations";
import { code, fmt, pre } from "@grammyjs/parse-mode";
import { db } from "../core/db.ts";
import { AppCookieJar } from "../utils/app-cookie-jar.ts";
import type { DinoContext, DinoParseModeContext } from "./dinogram.ts";

/**
 * Inside context objects (knows all conversation plugins)
 */
type DinoConversationContext = DinoParseModeContext;

/**
 * Use both the outside and the inside type for the conversation
 */
type DinoConversation = Conversation<DinoContext, DinoConversationContext>;

async function updateInstagramCookie(
  conversation: DinoConversation,
  ctx: DinoConversationContext,
) {
  await ctx.replyFmt(fmt([
    "Instagram cookie should contain at least 2 keys: ",
    fmt`${code("ds_user_id")} and ${code("session_id")}. `,
    fmt`\nExample: ${code("ds_user_id=123; sessionid=abc123")}`,
    "\n\nPlease send me the cookie value now:",
  ]));

  const { message } = await conversation.wait();

  if (!message?.text) {
    await ctx.reply(`No value provided. Update cancelled.`);
    return;
  }

  const jar = new AppCookieJar(message.text);
  const parsedCookie = jar.parse();
  if (parsedCookie.success) {
    await conversation.external(() =>
      db.instagram.cookie.set(jar.getCookieString())
    );
    await ctx.reply(`Instagram cookie updated.`);
  } else {
    await ctx.replyFmt(fmt([
      "Invalid Instagram cookie format: ",
      pre(JSON.stringify(parsedCookie.error, null, 2), "json"),
    ]));
  }
}

// TODO: Deduplicate
async function updateYoutubeCookie(
  conversation: DinoConversation,
  ctx: DinoConversationContext,
) {
  await ctx.replyFmt(fmt([
    "Please send me cookies for youtube.com in Netscape format:",
  ]));

  const { message } = await conversation.wait();

  const messageText = message?.text;
  if (!messageText) {
    await ctx.reply(`No value provided. Update cancelled.`);
    return;
  }

  // Telegram replaces tabs with double whitespaces.
  // However, Netscape format requires tabs to be used as separators.
  // Hence we need to manually restore the tabs.
  const originalMessage = messageText.replace(/ {2}/g, "\t");

  // TODO: Validate YouTube cookies
  await conversation.external(() => db.youtube.cookie.set(originalMessage));
  await ctx.reply(`YouTube cookie updated.`);
}

export const dinoConversations = {
  updateInstagramCookie,
  updateYoutubeCookie,
};
