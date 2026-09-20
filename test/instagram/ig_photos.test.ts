import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { InstagramClient } from "../../src/client/instagram-client.ts";
import { computeSHA1, test_url, writeToTestOutput } from "../test_util.ts";
import { db } from "../../src/core/db.ts";
import { config } from "../../src/core/config.ts";

Deno.test("Download Instagram photos [auth]", async () => {
  await db.instagram.cookie.set(config.TEST_INSTAGRAM_COOKIE);
  await test(722_577, "fe77c7fd83a096c5d694eb2777070e0d7b3d0ecc");
});

Deno.test("Download Instagram photos [anon]", async () => {
  await db.instagram.cookie.delete();
  await test(722_577, "fe77c7fd83a096c5d694eb2777070e0d7b3d0ecc");
});

async function test(firstImageSize: number, firstImageHash: string) {
  const url = new URL(test_url.instagram.images_only);
  const client = new InstagramClient(url);
  const post = await client.fetchPost();

  assert(
    post.type === "multi" && post.files.every(({ type }) => type === "photo"),
    "Instagram link is for photos",
  );

  assertStringIncludes(
    post.description,
    "Artemis III",
    "photo description matches",
  );

  assertEquals(post.files.length, 4, "Array elements match");

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
