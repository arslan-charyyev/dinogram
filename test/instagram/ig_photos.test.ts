import { assert, assertEquals } from "@std/assert";
import { InstagramClient } from "../../src/client/instagram-client.ts";
import { computeSHA1, test_url, writeToTestOutput } from "../test_util.ts";

Deno.test("Download Instagram photos", async () => {
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

  await writeToTestOutput(firstImageBytes, `ig_image.jpg`);

  assertEquals(
    firstImageBytes.byteLength,
    158_203,
    "first image length matches",
  );

  assertEquals(
    await computeSHA1(firstImageBytes),
    "2f90091a1aebaff36eff315ef49a5c3492605093",
    "first image hash matches",
  );
});
