import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { InstagramClient } from "../../src/client/instagram-client.ts";
import { db } from "../../src/core/db.ts";
import { computeSHA1, test_url, writeToTestOutput } from "../test_util.ts";

// Deno.test("Download Instagram photos with videos [auth]", async () => {
//   await db.instagram.cookie.set(config.TEST_INSTAGRAM_COOKIE);
//   await test(188_712, "648b8125c6f4eae262ae51084947471a693d1f7c");
// });

Deno.test("Download Instagram photos with videos [anon]", async () => {
  await db.instagram.cookie.del();
  await test(188_712, "648b8125c6f4eae262ae51084947471a693d1f7c");
});

async function test(firstImageSize: number, firstImageHash: string) {
  const url = new URL(test_url.instagram.images_with_videos);
  const client = new InstagramClient(url);
  const post = await client.fetchPost();

  assert(
    post.type === "multi" &&
      post.files.map((it) => it.type).includes("photo") &&
      post.files.map((it) => it.type).includes("video"),
    "Instagram link is for photos with videos",
  );

  assertStringIncludes(
    post.description,
    "their weekend getaway",
    "photo description matches",
  );

  assertEquals(post.files.length, 6, "Array elements match");

  const firstImageBytes = await client
    .fetch(post.files[0].downloadUrl)
    .then((it) => it.bytes());

  await writeToTestOutput(firstImageBytes, "ig_image.jpg");

  assertEquals(
    firstImageBytes.byteLength,
    firstImageSize,
    "first image size matches",
  );

  assertEquals(
    await computeSHA1(firstImageBytes),
    firstImageHash,
    "first image hash matches",
  );
}
