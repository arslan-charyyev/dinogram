import { assertEquals } from "@std/assert";
import {
  parseFeed,
  YouTubeChannels,
} from "../../src/client/youtube-channels.ts";
import {
  isDue,
  newEntries,
  pickOption,
} from "../../src/bot/subscription-worker.ts";
import type { Subscription } from "../../src/model/subscription.ts";
import type { YouTubeOption, YouTubeVideo } from "../../src/model/youtube.ts";

const DAY = 24 * 60 * 60 * 1000;

async function feed() {
  const url = new URL("./fixtures/channel_feed.xml", import.meta.url);
  return parseFeed(await Deno.readTextFile(url));
}

function subscription(changes: Partial<Subscription> = {}): Subscription {
  return {
    userId: 1,
    chatId: 1,
    channelId: "UCX6OQ3DkcsbYNE6H8uQQuVA",
    channelTitle: "MrBeast",
    format: "medium",
    frequency: "instant",
    withShorts: true,
    createdAt: 0,
    lastDeliveredAt: 0,
    pending: [],
    seen: [],
    ...changes,
  };
}

Deno.test("Feed: the channel, the uploads, and the Shorts", async () => {
  const { title, entries } = await feed();

  assertEquals(title, "MrBeast");
  assertEquals(
    entries.map((it) => [it.videoId, it.isShort]),
    [
      ["v9QtM6qnG50", false],
      ["T_SMf9j50uc", true],
      ["gTKS8SAwUzE", false],
      ["5mU6SRS2Bxo", true],
    ],
  );
  assertEquals(entries[0].publishedAt, Date.parse("2026-09-19T16:00:01Z"));
});

Deno.test("New entries: unseen ones after the subscription, the oldest first", async () => {
  const { entries } = await feed();

  const fresh = newEntries(
    subscription({
      createdAt: Date.parse("2026-09-01T00:00:00Z"),
      seen: ["gTKS8SAwUzE"],
    }),
    entries,
  );

  assertEquals(fresh.map((it) => it.videoId), ["T_SMf9j50uc", "v9QtM6qnG50"]);
});

Deno.test("New entries: Shorts stay out when the subscription skips them", async () => {
  const { entries } = await feed();

  const fresh = newEntries(subscription({ withShorts: false }), entries);

  assertEquals(fresh.map((it) => it.videoId), ["gTKS8SAwUzE", "v9QtM6qnG50"]);
});

Deno.test("Due: at once, a day, or a week after the last batch", () => {
  const now = 10 * DAY;
  const after = (days: number, frequency: Subscription["frequency"]) =>
    isDue(subscription({ frequency, lastDeliveredAt: now - days * DAY }), now);

  assertEquals(after(0, "instant"), true);
  assertEquals([after(0.5, "daily"), after(1, "daily")], [false, true]);
  assertEquals([after(6, "weekly"), after(7, "weekly")], [false, true]);
});

Deno.test("Format: the largest size that the format allows", () => {
  const option = (label: string, width: number, height: number) =>
    ({
      kind: "video",
      formatId: label,
      label,
      size: 1,
      width,
      height,
    }) satisfies YouTubeOption;
  const video = {
    videoOptions: [
      option("1080p", 1920, 1080),
      option("720p", 1280, 720),
      option("480p", 854, 480),
    ],
    audioOptions: [{
      kind: "audio",
      formatId: "140",
      label: "130 kbps",
      size: 1,
    }],
  } as unknown as YouTubeVideo;

  assertEquals(pickOption(video, "high")?.label, "1080p");
  assertEquals(pickOption(video, "medium")?.label, "720p");
  assertEquals(
    pickOption(video, "low")?.label,
    "480p",
    "the smallest one left",
  );
  assertEquals(pickOption(video, "audio")?.formatId, "140");
});

const links: [string, boolean][] = [
  ["https://www.youtube.com/@RickAstleyYT", true],
  ["https://m.youtube.com/@RickAstleyYT/videos", true],
  ["https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw", true],
  ["https://www.youtube.com/c/SomeName", true],
  ["https://www.youtube.com/user/RickAstleyVEVO", true],
  ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", false],
  ["https://www.youtube.com/@", false],
  ["https://youtu.be/dQw4w9WgXcQ", false],
];

for (const [url, expected] of links) {
  Deno.test(`Channel link ${url}`, () => {
    assertEquals(YouTubeChannels.isChannelLink(new URL(url)), expected);
  });
}
