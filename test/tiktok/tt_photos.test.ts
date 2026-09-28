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

  assertEquals(post.title, "", "photo title matches");

  assertEquals(
    post.description,
    "Did you spot any artists that you saw at Melkweg? 🤩 #photodump #concert #photography #melkwegamsterdam",
    "photo description matches",
  );

  assertEquals(post.files.length, 28, "Array elements match");

  assertEquals(post.audio?.title, "FEEL THE GROOVE", "audio title matches");

  const firstImageBytes = await client
    .fetch(post.files[0].downloadUrl)
    .then((it) => it.bytes());

  await writeToTestOutput(firstImageBytes, `tt_image.jpg`);

  assertEquals(
    firstImageBytes.byteLength,
    558_127,
    "first image length matches",
  );

  assertEquals(
    await computeSHA1(firstImageBytes),
    "7458a750d685fe25032d03606fd2ef1652798530",
    "first image hash matches",
  );
});
