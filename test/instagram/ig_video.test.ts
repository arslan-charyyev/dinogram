import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { InstagramClient } from "../../src/client/instagram-client.ts";
import { computeSHA1, test_url, writeToTestOutput } from "../test_util.ts";
import { db } from "../../src/core/db.ts";
import { config } from "../../src/core/config.ts";

Deno.test("Download Instagram video [auth]", async () => {
  await db.instagram.cookie.set(config.TEST_INSTAGRAM_COOKIE);
  await test(391_145, "2a882df1e66500b9ddfbe025800dcf66fbf98e0f");
});

Deno.test("Download Instagram video [anon]", async () => {
  await db.instagram.cookie.delete();
  await test(391_145, "2a882df1e66500b9ddfbe025800dcf66fbf98e0f");
});

async function test(videoSize: number, videoHash: string) {
  const url = new URL(test_url.instagram.video);
  const client = new InstagramClient(url);
  const post = await client.fetchPost();

  assert(
    post.type === "single" && post.file.type === "video",
    "Link is for a video",
  );

  assertStringIncludes(
    post.description,
    "Vibing with Shiba Inu",
    "video description matches",
  );

  const video = await client.fetch(post.file.downloadUrl);
  assert(video.ok, "video is fetched");

  const videoBytes = await video.bytes();

  await writeToTestOutput(videoBytes, "ig_video.mp4");

  assertEquals(videoBytes.byteLength, videoSize, "video size matches");
  assertEquals(await computeSHA1(videoBytes), videoHash, "video hash matches");
}
