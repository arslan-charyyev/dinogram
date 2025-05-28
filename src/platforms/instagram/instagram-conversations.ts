import {
  type DinoConversation,
  type DinoConversationContext,
  registerConversation,
} from "../../bot/conversations.ts";

async function loginToInstagram(
  conversation: DinoConversation,
  ctx: DinoConversationContext,
) {
  const url = "https://todo.dev/instagram-login";

  await ctx.reply(
    `Open the following page and login to your Instagram account: ${url}`,
  );

  /* const { message } = */ await conversation.wait();

  await ctx.reply(`Not implemented yet. Leaving conversation.`);

  // TODO: Prompt user to navigate to login page

  // await ctx.replyFmt(fmt([
  //   "Instagram cookie should contain at least 2 keys: ",
  //   fmt`${code("ds_user_id")} and ${code("session_id")}. `,
  //   fmt`\nExample: ${code("ds_user_id=123; sessionid=abc123")}`,
  //   "\n\nPlease send me the cookie value now:",
  // ]));

  // const { message } = await conversation.wait();

  // if (!message?.text) {
  //   await ctx.reply(`No value provided. Update cancelled.`);
  //   return;
  // }

  // const cookieStr = message.text + ";domain=instagram.com";
  // const jar = new AppCookieJar(cookieStr);
  // const parsedCookie = jar.safeParse(InstagramCookie);
  // if (parsedCookie.success) {
  //   await conversation.external(() =>
  //     db.instagram.cookie.set(jar.getCookieString())
  //   );
  //   await db.instagram.cookie.set(message.text);
  //   await ctx.reply(`Instagram cookie updated.`);
  // } else {
  //   await ctx.replyFmt(fmt([
  //     "Invalid Instagram cookie format: ",
  //     pre(JSON.stringify(parsedCookie.error, null, 2), "json"),
  //   ]));
  // }
}

export const instagramConversations = {
  loginToInstagram,
};

registerConversation(loginToInstagram);
