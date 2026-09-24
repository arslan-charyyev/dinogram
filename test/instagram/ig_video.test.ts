import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { InstagramClient } from "../../src/client/instagram-client.ts";
import { computeSHA1, test_url, writeToTestOutput } from "../test_util.ts";
import { db } from "../../src/core/db.ts";
import { config } from "../../src/core/config.ts";

Deno.test("Download Instagram video [auth]", async () => {
  await db.instagram.cookie.set(config.TEST_INSTAGRAM_COOKIE);
  // A signed-in session gets another encoding of the same reel, and which one
  // it gets changes over time. Thus only the anonymous test pins the bytes.
  await test();
});

Deno.test("Download Instagram video [anon]", async () => {
  await db.instagram.cookie.delete();
  await test({
    size: 1_031_328,
    hash: "cbf3afd94ec57a0856368712cf6fbabd8f721642",
  });
});

async function test(expected?: { size: number; hash: string }) {
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

  if (expected) {
    assertEquals(videoBytes.byteLength, expected.size, "video size matches");
    assertEquals(
      await computeSHA1(videoBytes),
      expected.hash,
      "video hash matches",
    );
  } else {
    const boxType = new TextDecoder().decode(videoBytes.subarray(4, 8));
    assertEquals(boxType, "ftyp", "video is an MP4 file");
  }
}
