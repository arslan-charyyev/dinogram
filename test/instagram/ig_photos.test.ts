import { assert, assertEquals } from "@std/assert";
import { InstagramClient } from "../../src/client/instagram-client.ts";
import { computeSHA1, test_url, writeToTestOutput } from "../test_util.ts";
import { db } from "../../src/core/db.ts";
import { config } from "../../src/core/config.ts";

// TODO: Uncomment this
Deno.test("Download Instagram photos [auth]", async () => {
  await db.instagram.cookie.set(config.TEST_INSTAGRAM_COOKIE);
  await test(158_203, "2f90091a1aebaff36eff315ef49a5c3492605093");
});

Deno.test("Download Instagram photos [anon]", async () => {
  await db.instagram.cookie.delete();
  await test(158_203, "2f90091a1aebaff36eff315ef49a5c3492605093");
});

async function test(firstImageSize: number, firstImageHash: string) {
  const url = new URL(test_url.instagram.images_only);
  const client = new InstagramClient(url);
  const post = await client.fetchPost();

  assert(
    post.type === "multi" && post.files.every(({ type }) => type === "photo"),
    "Instagram link is for photos",
  );

  assertEquals(
    post.description,
    "White M🥶",
    "photo description matches",
  );

  assertEquals(post.files.length, 2, "Array elements match");

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
