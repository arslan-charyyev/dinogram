/// <reference lib="deno.unstable" />

import { resolve } from "@std/path";
import type { Channel } from "../model/subscription.ts";
import type {
  CachedYouTubeFile,
  YouTubeCard,
  YouTubeVideo,
} from "../model/youtube.ts";
import { config } from "./config.ts";
import { Subscriptions } from "./subscriptions.ts";
import { Whitelist } from "./whitelist.ts";

const dbPath = config.DATA_DIR
  ? resolve(config.DATA_DIR, "kv.sqlite3")
  : undefined;

const kv = await Deno.openKv(dbPath);

export const db = {
  instagram: {
    cookie: createModel<string>(["instagram", "cookie"]),
  },
  youtube: {
    cookie: createModel<string>(["youtube", "cookie"]),
    /**
     * The formats of a video, keyed by the video ID. A menu press finds them
     * here instead of waiting for yt-dlp again. They expire, because YouTube
     * changes the formats that it offers over time.
     */
    video: createKeyedModel<YouTubeVideo>(["youtube", "video"], {
      expireIn: 6 * 60 * 60 * 1000,
    }),
    /**
     * Keyed by the video ID and the format selector
     */
    file: createKeyedModel<CachedYouTubeFile>(["youtube", "file"]),
    /**
     * Keyed by the chat ID and the message ID of the card. A press on an
     * older card asks for the link again.
     */
    /**
     * The channels that a subscription menu shows, keyed by the channel ID.
     * A menu step finds the title here instead of asking YouTube again.
     */
    channel: createKeyedModel<Channel>(["youtube", "channel"], {
      expireIn: 7 * 24 * 60 * 60 * 1000,
    }),
    card: createKeyedModel<YouTubeCard>(["youtube", "card"], {
      expireIn: 30 * 24 * 60 * 60 * 1000,
    }),
  },
  whitelist: new Whitelist(kv),
  subscriptions: new Subscriptions(kv),
};

/**
 * This function allows us to create a DB layer that:
 * 1. Decouples the DB implementation (Deno KV) from the business logic
 * 2. Provides a standardized interface for managing data
 */
function createModel<T>(key: string[]) {
  const dinogramKey = ["dinogram", ...key];

  return {
    set: (value: T) => kv.set(dinogramKey, value),
    get: () => kv.get<T>(dinogramKey).then(({ value }) => value),
    delete: () => kv.delete(dinogramKey),
  };
}

/**
 * The same as {@link createModel}, for a collection of values under one key
 */
function createKeyedModel<T>(key: string[], options?: { expireIn?: number }) {
  const dinogramKey = ["dinogram", ...key];

  return {
    set: (id: string[], value: T) =>
      kv.set([...dinogramKey, ...id], value, options),
    get: (id: string[]) =>
      kv.get<T>([...dinogramKey, ...id]).then(({ value }) => value),
    delete: (id: string[]) => kv.delete([...dinogramKey, ...id]),
  };
}
