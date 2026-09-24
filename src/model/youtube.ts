/**
 * How yt-dlp reached the formats. A download reuses the same way, because the
 * formats that YouTube offers depend on it.
 */
export type YouTubeAccess =
  /** The visionOS client, which needs no JavaScript runtime and little memory */
  | "visionos"
  /** The default clients of yt-dlp, which run the Deno challenge solver */
  | "default"
  /** The default clients with the cookie that an admin set in /settings */
  | "cookie";

export type YouTubeOption = {
  readonly kind: "video" | "audio";
  /** A yt-dlp format selector, such as "137+140" or "140-23" */
  readonly formatId: string;
  /** The text on the button, such as "720p" or "129 kbps" */
  readonly label: string;
  /** Bytes, or 0 when YouTube does not report the size */
  readonly size: number;
  readonly width?: number;
  readonly height?: number;
};

export type YouTubeVideo = {
  readonly id: string;
  readonly title: string;
  readonly channel: string;
  /** Seconds */
  readonly duration: number;
  readonly isShort: boolean;
  /** The largest first. Only the options that the bot can deliver. */
  readonly videoOptions: YouTubeOption[];
  /** The best first. Only the options that the bot can deliver. */
  readonly audioOptions: YouTubeOption[];
  readonly access: YouTubeAccess;
};

/**
 * A file that Telegram already holds. A repeated request resends it by its ID
 * instead of downloading it again.
 */
export type CachedYouTubeFile = {
  readonly kind: "video" | "audio";
  readonly fileId: string;
};

/**
 * A menu card that the bot showed. Only the bot writes it, so a press can
 * trust it, unlike the callback data, which a client can forge.
 */
export type YouTubeCard = {
  readonly videoId: string;
  /** The user who sent the link, or 0 when anybody may cancel the card */
  readonly owner: number;
  /** A done card has turned into its file, so its old pickers are stale */
  readonly state: "open" | "done";
};

/**
 * A YouTube link, parsed from the URL alone
 */
export type YouTubeLink =
  | {
    readonly type: "video";
    readonly id: string;
    /** The URL has the /shorts/ path. A watch link can be a Short too. */
    readonly isShort: boolean;
  }
  | { readonly type: "playlist" };
