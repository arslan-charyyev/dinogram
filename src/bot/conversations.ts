import { Conversation } from "@grammyjs/conversations";
import { DinoContext } from "./dinogram.ts";
import { db } from "../core/db.ts";
import { code, fmt, pre } from "@grammyjs/parse-mode";
import { z } from "zod";

type DinoConversation = Conversation<DinoContext>;

async function setInstagramCookie(
  conversation: DinoConversation,
  ctx: DinoContext,
) {
  await ctx.replyFmt(fmt([
    "Instagram cookie should contain at least 2 keys: ",
    fmt`${code("ds_user_id")} and ${code("session_id")}. `,
    fmt`\nExample: ${code("ds_user_id=123; sessionid=abc123")}`,
    "\n\nPlease send me the cookie value now:",
  ]));

  const { message } = await conversation.wait();

  if (message?.text) {
    const cookieObject = message.text
      .split(";")
      .filter(Boolean)
      .map((it) => it.trim().split("="))
      .reduce((object, [key, value]) => {
        object[key] = value;
        return object;
      }, {} as Record<string, string>);

    const parsedCookie = z.object({
      ds_user_id: z.string().transform(Number).pipe(z.number().int()),
      sessionid: z.string(),
    }).safeParse(cookieObject);

    if (parsedCookie.success) {
      await db.instagram.cookie.set(message.text);
      await ctx.reply(`Instagram cookie updated.`);
    } else {
      await ctx.replyFmt(fmt([
        "Invalid Instagram cookie format: ",
        pre(JSON.stringify(parsedCookie.error, null, 2), "json"),
      ]));
    }
  } else {
    await ctx.reply(`No value provided. Update cancelled.`);
  }
}

export const dinoConversations = {
  setInstagramCookie,
};
