import { assertEquals } from "@std/assert";
import { YouTubeChannels } from "../../src/client/youtube-channels.ts";

// These tests read public YouTube pages and feeds, with no yt-dlp

const RICK_ASTLEY = "UCuAXFkgsw1L7xaCfnd5JJOw";

for (
  const url of [
    "https://www.youtube.com/@RickAstleyYT",
    "https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw/videos",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  ]
) {
  Deno.test(`Resolve the channel of ${url}`, async () => {
    const channel = await YouTubeChannels.resolve(new URL(url));
    assertEquals(channel, { id: RICK_ASTLEY, title: "Rick Astley" });
  });
}

Deno.test("Read the feed of a channel", async () => {
  const { entries } = await YouTubeChannels.fetchFeed(RICK_ASTLEY);
  assertEquals(entries.length, 15);
});
