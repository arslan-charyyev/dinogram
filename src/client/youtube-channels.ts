import { retry } from "@std/async";
import { messages } from "../core/messages.ts";
import type { Channel, FeedEntry } from "../model/subscription.ts";
import { getUrlSegments } from "../utils/utils.ts";
import { YouTubeClient, YouTubeUserError } from "./youtube-client.ts";

const YOUTUBE_HOST = /(^|\.)youtube\.com$/;
const CHANNEL_ID = /^UC[\w-]{22}$/;

/**
 * The channel pages ask an EU visitor for consent first. The page still
 * carries the channel ID behind that question, and the language keeps the
 * title stable.
 */
const PAGE_HEADERS = {
  "Accept-Language": "en",
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Firefox/130.0",
};

/**
 * Reads YouTube channels through their public pages and RSS feeds. Neither
 * goes through the video player, so the sign-in wall that YouTube raises for
 * a server IP does not block them.
 */
export const YouTubeChannels = {
  /**
   * True for /@handle, /channel/UC…, /c/name, and /user/name, with or
   * without a tab such as /videos
   */
  isChannelLink(url: URL): boolean {
    if (!YOUTUBE_HOST.test(url.hostname.toLowerCase())) return false;

    const [first, second] = getUrlSegments(url);
    if (first?.startsWith("@") && first.length > 1) return true;
    return ["channel", "c", "user"].includes(first ?? "") && !!second;
  },

  /**
   * Finds the channel of a channel link, or the channel of a video link
   */
  async resolve(url: URL): Promise<Channel> {
    const channelId = await findChannelId(url);
    const feed = await YouTubeChannels.fetchFeed(channelId);
    return { id: channelId, title: feed.title };
  },

  async fetchFeed(
    channelId: string,
  ): Promise<{ title: string; entries: FeedEntry[] }> {
    const response = await retry(() =>
      fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`)
    );

    if (response.status === 404) {
      await response.body?.cancel();
      throw new YouTubeUserError(messages.SUBSCRIPTION_NO_CHANNEL);
    }
    if (!response.ok) {
      throw Error("YouTube feed not OK", {
        cause: { channelId, status: response.status },
      });
    }

    return parseFeed(await response.text());
  },
};

async function findChannelId(url: URL): Promise<string> {
  const [first, second] = getUrlSegments(url);
  if (first === "channel" && CHANNEL_ID.test(second ?? "")) return second;

  let page = url;

  // A video page lists many channels in its recommendations. oEmbed names
  // the one that uploaded the video.
  const video = YouTubeClient.parseLink(url);
  if (video?.type === "video") {
    const oembed = await retry(() =>
      fetch(
        "https://www.youtube.com/oembed?format=json&url=" +
          encodeURIComponent(YouTubeClient.watchUrl(video.id)),
      )
    );
    if (!oembed.ok) {
      await oembed.body?.cancel();
      throw new YouTubeUserError(messages.SUBSCRIPTION_NO_CHANNEL);
    }

    const { author_url: authorUrl } = await oembed.json();
    if (typeof authorUrl !== "string") {
      throw new YouTubeUserError(messages.SUBSCRIPTION_NO_CHANNEL);
    }
    page = new URL(authorUrl);
  }

  const response = await retry(() => fetch(page, { headers: PAGE_HEADERS }));
  if (!response.ok) {
    await response.body?.cancel();
    throw new YouTubeUserError(messages.SUBSCRIPTION_NO_CHANNEL);
  }

  const html = await response.text();
  const id = html.match(/"externalId":"(UC[\w-]{22})"/)?.[1] ??
    html.match(/<link rel="canonical" href="[^"]*\/channel\/(UC[\w-]{22})"/)
      ?.[1];
  if (!id) throw new YouTubeUserError(messages.SUBSCRIPTION_NO_CHANNEL);

  return id;
}

/**
 * The feed lists the 15 newest uploads, the newest first
 */
export function parseFeed(
  xml: string,
): { title: string; entries: FeedEntry[] } {
  const title = decodeXml(
    xml.match(/<title>([^<]*)<\/title>/)?.[1] ?? "",
  );

  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .map(([, entry]) => {
      const videoId = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
      const published = entry.match(/<published>([^<]+)<\/published>/)?.[1];
      const link = entry.match(/<link rel="alternate" href="([^"]+)"/)?.[1];

      if (!videoId || !published) return undefined;

      return {
        videoId,
        title: decodeXml(entry.match(/<title>([^<]*)<\/title>/)?.[1] ?? ""),
        publishedAt: Date.parse(published),
        isShort: link?.includes("/shorts/") ?? false,
      } satisfies FeedEntry;
    })
    .filter((it) => it !== undefined);

  return { title, entries };
}

function decodeXml(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}
