import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { computeSHA1, test_url, writeToTestOutput } from "../test_util.ts";
import { InstagramClient } from "../../src/client/instagram-client.ts";

Deno.test("Download Instagram photos", async () => {
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

  await writeToTestOutput(firstImageBytes, `ig_image.jpg`);

  assertEquals(
    firstImageBytes.byteLength,
    163_171,
    "first image length matches",
  );

  assertEquals(
    await computeSHA1(firstImageBytes),
    "2eb0a0d26ab9aeb9f4785c8ffb3c859ff86c738b",
    "first image hash matches",
  );
});
