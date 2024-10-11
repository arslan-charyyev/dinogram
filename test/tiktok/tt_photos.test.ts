import { assert, assertEquals } from "@std/assert";
import { TikTokClient } from "../../src/client/tiktok-client.ts";
import { computeSHA1, test_url, writeToTestOutput } from "../test_util.ts";

Deno.test("Download TikTok photos", async () => {
  const url = new URL(test_url.tiktok.photos);
  const client = new TikTokClient(url);
  const post = await client.fetchPost();

  assert(
    post.type === "multi" && post.files.every(({ type }) => type === "photo"),
    "TikTok link is for photos",
  );

  assertEquals(
    post.title,
    "Lorem photo title",
    "photo title matches",
  );

  assertEquals(
    post.description,
    "Lorem photo description",
    "photo description matches",
  );

  assertEquals(post.files.length, 25, "Array elements match");

  const firstImageBytes = await client
    .fetch(post.files[0].downloadUrl)
    .then((it) => it.bytes());

  await writeToTestOutput(firstImageBytes, `tt_image.jpg`);

  assertEquals(
    firstImageBytes.byteLength,
    17_346,
    "first image length matches",
  );

  assertEquals(
    await computeSHA1(firstImageBytes),
    "1a5c5ecec9f89d450fb74c7c92b7f614e04cda1f",
    "first image hash matches",
  );
});
