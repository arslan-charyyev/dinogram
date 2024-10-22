import { Conversation } from "@grammyjs/conversations";
import { DinoContext } from "./dinogram.ts";
import { db } from "../core/db.ts";

type DinoConversation = Conversation<DinoContext>;

async function setInstagramCookie(
  conversation: DinoConversation,
  ctx: DinoContext,
) {
  await ctx.reply(`Please send me the cookie value:`);

  const { message } = await conversation.wait();

  if (message?.text) {
    await db.instagram.cookie.set(message.text);
    await ctx.reply(`Instagram cookie updated.`);
  } else {
    await ctx.reply(`No value provided. Update cancelled.`);
  }
}

export const dinoConversations = {
  setInstagramCookie,
};
