export const messages = {
  ALLOW_ADDED: (target: string) => `✅ Allowed ${target}`,
  ALLOW_ALREADY: (target: string) => `ℹ️ ${target} was allowed already`,
  ALLOWED_LIST: (
    admins: number[],
    seeded: number[],
    entries: string[],
  ) =>
    [
      `👑 Admins: ${admins.join(", ") || "none"}`,
      `📌 From the config: ${seeded.join(", ") || "none"}`,
      "📝 Added in chat:",
      ...(entries.length > 0 ? entries.map((it) => `• ${it}`) : ["• none"]),
    ].join("\n"),
  DENY_MISSING: (target: string) => `ℹ️ ${target} was not on the whitelist`,
  DENY_REMOVED: (target: string) => `✅ Denied ${target}`,
  INLINE_DOWNLOADING: "⏳ Downloading…",
  INLINE_MORE_ITEMS: "open the original post for the rest",
  INLINE_NO_LINK: "Paste a link to a supported post",
  INLINE_OPEN_ORIGINAL: "🔗 Open original",
  INLINE_RESULT_TITLE: "Download from",
  INLINE_START_BOT:
    "Send /start to the bot in a private chat, then try again. The bot needs that chat to upload the media.",
  INLINE_UNAUTHORIZED: "🚫 You are not authorized to use this bot",
  INVALID_LINK: "Invalid link",
  PHOTO_POST_UNAVAILABLE:
    "Cannot download this TikTok photo post. TikTok now serves the images only through a request that it refuses from this bot. Videos still work.",
  NOT_ADMIN: "🚫 Only an admin can change the whitelist.",
  NOT_ALLOWED: (userId: number, chatId: number) =>
    "🚫 Sorry. You are not authorized to make requests to this bot.\n" +
    `Your user ID: ${userId}\n` +
    `This chat ID: ${chatId}\n` +
    "Send them to an admin to ask for access.",
  NOT_AN_ID: (arg: string) => `❌ "${arg}" is not an ID`,
  POSSIBLY_SIGN_IN_REQUIRED:
    "Cannot download the media. Probable reasons: private video or sign-in required.",
};
