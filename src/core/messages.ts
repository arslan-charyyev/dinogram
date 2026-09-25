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
  EXTERNAL_MEDIA: (url: string) =>
    `This post shows a video from another site, which the bot does not download: ${url}`,
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
  PINTEREST_NOT_A_PIN:
    "Only single pins are supported, not boards or profiles.",
  PINTEREST_NOT_FOUND:
    "Pin not found. It may be deleted, or visible only to signed-in users.",
  PINTEREST_NO_VIDEO_FILE:
    "Pinterest offers this video only as a stream, which the bot cannot send.",
  POSSIBLY_SIGN_IN_REQUIRED:
    "Cannot download the media. Probable reasons: private video or sign-in required.",
  YOUTUBE_AUDIO: "🎵 Audio",
  YOUTUBE_BACK: "⬅️ Back",
  YOUTUBE_BUSY_CARD: "Somebody already chose a format for this video.",
  YOUTUBE_BUSY_USER:
    "You already have a YouTube download running. Wait until it finishes.",
  YOUTUBE_CANCEL: "✖️ Cancel",
  YOUTUBE_CANCEL_DENIED: "Only the person who sent the link can cancel.",
  YOUTUBE_CHOOSE_AUDIO: "Choose the audio quality",
  YOUTUBE_CHOOSE_FORMAT: "Choose a format",
  YOUTUBE_CHOOSE_VIDEO: "Choose the video quality",
  YOUTUBE_CLOSE: "✖️ Close",
  YOUTUBE_DOWNLOADING: (label: string, percent?: number) =>
    `⏳ Downloading ${label}` +
    (percent === undefined ? "…" : ` · ${percent}%`),
  YOUTUBE_FAILED: "❌ The download failed. Choose a format to try again.",
  YOUTUBE_INLINE_AUDIO: "🎵 Audio",
  YOUTUBE_INLINE_MEDIUM: "🎬 Video · medium quality",
  YOUTUBE_INLINE_SHORT: "🎬 Download the Short",
  YOUTUBE_LIVE: "Cannot download a live stream or a premiere.",
  YOUTUBE_NO_OPTIONS:
    "No format of this video fits the upload limit or the length limit.",
  YOUTUBE_OUTDATED: "This menu is out of date. Send the link again.",
  YOUTUBE_PLAYLIST: "Playlists are not supported. Send a link to one video.",
  YOUTUBE_QUEUED: "⏳ Waiting for a free download slot…",
  YOUTUBE_REQUESTED_BY: "Requested by ",
  YOUTUBE_SIGN_IN:
    "YouTube asks this server to sign in. An admin can set a YouTube cookie in /settings.",
  YOUTUBE_SIGN_IN_COOKIE:
    "YouTube asks this server to sign in, and the YouTube cookie did not help. An admin can set a new one in /settings.",
  YOUTUBE_TOO_LARGE: "The file is larger than the upload limit.",
  YOUTUBE_UPLOADING: "📤 Uploading…",
  YOUTUBE_VIDEO: "🎬 Video",
};
