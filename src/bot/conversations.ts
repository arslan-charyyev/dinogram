import type { Conversation } from "@grammyjs/conversations";
import { code, fmt, pre } from "@grammyjs/parse-mode";
import { db } from "../core/db.ts";
import { AppCookieJar } from "../utils/app-cookie-jar.ts";
import { parseYouTubeCookies } from "../utils/netscape-cookies.ts";
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
    await conversation.external(() =>
      db.instagram.cookie.set(jar.getCookieString())
    );
    await db.instagram.cookie.set(message.text);
    await ctx.reply(`Instagram cookie updated.`);
  } else {
    await ctx.replyFmt(fmt([
      "Invalid Instagram cookie format: ",
      pre(JSON.stringify(parsedCookie.error, null, 2), "json"),
    ]));
  }
}

/**
 * A cookies.txt file can be longer than one Telegram message (4096
 * characters), so the admin may send it in several messages, and ends with
 * /done.
 */
async function setYouTubeCookie(
  conversation: DinoConversation,
  ctx: DinoConversationContext,
) {
  await ctx.replyFmt(fmt([
    "Send the cookies of youtube.com in the Netscape format, which is the ",
    fmt`content of a ${code("cookies.txt")} file. `,
    "You can send a long file in several messages.\n\n",
    "Export the cookies from a private browser window with a spare account, ",
    "and close that window right after the export, so that YouTube does not ",
    "replace them. YouTube can ban the account of the cookies.\n\n",
    fmt`Send ${code("/done")} when you are finished, or ${
      code("/cancel")
    } to stop.`,
  ]));

  const parts: string[] = [];

  while (true) {
    const { message } = await conversation.wait();
    const text = message?.text?.trim();

    if (!text || text === "/cancel") {
      await ctx.reply(`Update cancelled.`);
      return;
    }

    if (text === "/done") break;

    parts.push(text);
  }

  const cookie = parseYouTubeCookies(parts.join("\n"));
  if (!cookie) {
    await ctx.reply(
      "No cookie for youtube.com was found in the text. Update cancelled.",
    );
    return;
  }

  await conversation.external(() => db.youtube.cookie.set(cookie));
  await ctx.reply(`YouTube cookie updated.`);
}

export const dinoConversations = {
  setInstagramCookie,
  setYouTubeCookie,
};
