import type { Api } from "grammy";
import { YouTubeChannels } from "../client/youtube-channels.ts";
import { YouTubeClient } from "../client/youtube-client.ts";
import { config } from "../core/config.ts";
import { db } from "../core/db.ts";
import { log } from "../core/log.ts";
import { messages } from "../core/messages.ts";
import type {
  FeedEntry,
  PendingVideo,
  Subscription,
} from "../model/subscription.ts";
import type { YouTubeOption, YouTubeVideo } from "../model/youtube.ts";
import { isAllowed } from "./access.ts";
import { CaptionBuilder } from "./caption-builder.ts";
import { deliver, statusApi, statusUpdater } from "./youtube-delivery.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A batch sends at most this many videos. The rest wait for the next batch,
 * so a channel that uploads a season at once cannot flood the chat.
 */
const BATCH_SIZE = 10;

/**
 * A premiere stays undownloadable until it ends, and a sign-in wall can pass,
 * so a video gets several tries before the user gets its link instead
 */
const MAX_ATTEMPTS = 8;

/**
 * The feed lists 15 uploads, so a few more IDs cover every video that can
 * come back into the feed
 */
const SEEN_LIMIT = 50;

const FORMAT_HEIGHTS = { high: 1080, medium: 720, low: 360 } as const;

/**
 * Checks the feeds of the subscribed channels and sends the new videos. One
 * check runs at a time, and the next one starts after the interval.
 */
export function startSubscriptionWorker(api: Api) {
  const interval = config.SUBSCRIPTION_CHECK_MINUTES * 60_000;

  const run = async () => {
    try {
      await checkFeeds();
      await deliverDueBatches(api);
    } catch (e) {
      log.error("Subscription check failed", e);
    } finally {
      setTimeout(run, interval);
    }
  };

  // The first check waits a minute, so that a restart loop cannot hammer
  // YouTube
  setTimeout(run, 60_000);
}

async function checkFeeds() {
  const subscriptions = await db.subscriptions.listAll();
  const channelIds = [...new Set(subscriptions.map((it) => it.channelId))];

  for (const channelId of channelIds) {
    let entries: FeedEntry[];
    try {
      ({ entries } = await YouTubeChannels.fetchFeed(channelId));
    } catch (e) {
      log.warn(`Feed of ${channelId} failed: ${e}`);
      continue;
    }

    for (const it of subscriptions.filter((it) => it.channelId === channelId)) {
      // The menu can change the subscription meanwhile, so the update
      // starts from the stored one
      const current = await db.subscriptions.get(it.userId, channelId);
      if (!current) continue;

      const fresh = newEntries(current, entries);
      const seen = [
        ...new Set([...entries.map((it) => it.videoId), ...current.seen]),
      ].slice(0, SEEN_LIMIT);

      if (fresh.length === 0 && seen.length === current.seen.length) continue;

      await db.subscriptions.set({
        ...current,
        pending: [
          ...current.pending,
          ...fresh.map((it) => ({
            id: it.videoId,
            title: it.title,
            attempts: 0,
          })),
        ],
        seen,
      });
    }
  }
}

/**
 * The entries that the subscription has not seen, the oldest first. An
 * entry from before the subscription never counts, even when YouTube moves
 * it back into the feed.
 */
export function newEntries(
  subscription: Subscription,
  entries: FeedEntry[],
): FeedEntry[] {
  return entries
    .filter((it) =>
      !subscription.seen.includes(it.videoId) &&
      it.publishedAt >= subscription.createdAt &&
      (subscription.withShorts || !it.isShort)
    )
    .sort((a, b) => a.publishedAt - b.publishedAt);
}

export function isDue(subscription: Subscription, now: number): boolean {
  const waited = now - subscription.lastDeliveredAt;

  switch (subscription.frequency) {
    case "instant":
      return true;
    case "daily":
      return waited >= DAY_MS;
    case "weekly":
      return waited >= 7 * DAY_MS;
  }
}

/**
 * The largest video size that the format allows, or the best audio
 */
export function pickOption(
  video: YouTubeVideo,
  format: Subscription["format"],
): YouTubeOption | undefined {
  if (format === "audio") return video.audioOptions[0];

  const height = FORMAT_HEIGHTS[format];
  return video.videoOptions.find((it) =>
    Math.min(it.width ?? 0, it.height ?? 0) <= height
  ) ?? video.videoOptions.at(-1);
}

async function deliverDueBatches(api: Api) {
  const now = Date.now();

  for (const subscription of await db.subscriptions.listAll()) {
    if (subscription.pending.length === 0) continue;
    if (!isDue(subscription, now)) continue;

    // An admin can take a user off the whitelist; the videos then wait
    if (!await isAllowed(subscription.userId)) continue;

    const batch = subscription.pending.slice(0, BATCH_SIZE);
    const retry: PendingVideo[] = [];

    for (const item of batch) {
      // A failed send, such as to a user who blocked the bot, costs one
      // attempt of this video, and the other subscriptions still get theirs
      const result = await deliverOne(api, subscription, item).catch((e) => {
        log.warn(`Subscription video ${item.id} failed: ${e}`);
        return "retry" as const;
      });
      if (result === "retry") {
        if (item.attempts + 1 < MAX_ATTEMPTS) {
          retry.push({ ...item, attempts: item.attempts + 1 });
        } else {
          await notify(
            api,
            subscription,
            messages.SUBSCRIPTION_GAVE_UP(
              item.title,
              YouTubeClient.watchUrl(item.id),
            ),
          );
        }
      }
    }

    const current = await db.subscriptions.get(
      subscription.userId,
      subscription.channelId,
    );
    if (!current) continue;

    const handled = new Set(batch.map((it) => it.id));
    await db.subscriptions.set({
      ...current,
      pending: [
        ...retry,
        ...current.pending.filter((it) => !handled.has(it.id)),
      ],
      lastDeliveredAt: now,
    });
  }
}

async function deliverOne(
  api: Api,
  subscription: Subscription,
  item: PendingVideo,
): Promise<"done" | "retry"> {
  let video: YouTubeVideo;
  try {
    video = await YouTubeClient.fetchVideo(item.id);
  } catch (e) {
    // A premiere that has not ended, or a sign-in wall
    log.warn(`Subscription video ${item.id} is not ready: ${e}`);
    return "retry";
  }

  const option = pickOption(video, subscription.format);
  if (!option) {
    await notify(
      api,
      subscription,
      messages.SUBSCRIPTION_NO_FORMAT(
        video.title,
        YouTubeClient.watchUrl(video.id),
      ),
    );
    return "done";
  }

  const message = await api.sendMessage(
    subscription.chatId,
    messages.SUBSCRIPTION_NEW(subscription.channelTitle, video.title),
    { link_preview_options: { is_disabled: true } },
  );

  const status = statusUpdater((text) =>
    statusApi.editMessageText(subscription.chatId, message.message_id, text)
  );

  try {
    await deliver(
      video,
      option,
      {
        type: "message",
        chatId: subscription.chatId,
        messageId: message.message_id,
      },
      CaptionBuilder.youtube(video),
      status,
    );
    return "done";
  } catch (e) {
    log.warn(`Subscription video ${item.id} failed: ${e}`);
    await status.idle();
    await api.deleteMessage(subscription.chatId, message.message_id)
      .catch(() => {});
    return "retry";
  }
}

async function notify(api: Api, subscription: Subscription, text: string) {
  await api.sendMessage(subscription.chatId, text, {
    link_preview_options: { is_disabled: true },
  }).catch((e) => log.error("Subscription notice failed", e));
}
