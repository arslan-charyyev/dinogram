import type { Conversation } from "@grammyjs/conversations";
import { code, fmt, pre } from "@grammyjs/parse-mode";
import { db } from "../core/db.ts";
import { AppCookieJar } from "../utils/app-cookie-jar.ts";
import type { DinoContext, DinoParseModeContext } from "./dinogram.ts";

type DinoConversationContext = DinoParseModeContext;

type DinoConversation = Conversation<DinoContext, DinoConversationContext>;

async function setInstagramCookie(
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
    await db.instagram.cookie.set(message.text);
    await ctx.reply(`Instagram cookie updated.`);
  } else {
    await ctx.replyFmt(fmt([
      "Invalid Instagram cookie format: ",
      pre(JSON.stringify(parsedCookie.error, null, 2), "json"),
    ]));
  }
}

export const dinoConversations = {
  setInstagramCookie,
};
