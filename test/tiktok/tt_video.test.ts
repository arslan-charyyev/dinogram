import { assert, assertEquals } from "@std/assert";
import { TikTokClient } from "../../src/client/tiktok-client.ts";
import { computeSHA1, test_url, writeToTestOutput } from "../test_util.ts";

Deno.test("Download TikTok video", async () => {
  const url = new URL(test_url.tiktok.video);
  const client = new TikTokClient(url);
  const post = await client.fetchPost();

  assert(
    post.type === "single" && post.file.type === "video",
    "Link is for a video",
  );

  assertEquals(
    post.description,
    "Just a black screen #fypシ #black screen",
    "video description matches",
  );

  const video = await client.fetch(post.file.downloadUrl);
  assert(video.ok, "video is fetched");

  const videoBytes = await video.bytes();

  await writeToTestOutput(videoBytes, `tt_video.mp4`);

  assertEquals(
    videoBytes.byteLength,
    60_931,
    "video length matches",
  );

  assertEquals(
    await computeSHA1(videoBytes),
    "5f32232241401759e94663ea4fd97781f4d52e35",
    "video hash matches",
  );
});
