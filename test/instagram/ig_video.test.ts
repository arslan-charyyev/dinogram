import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { InstagramClient } from "../../src/client/instagram-client.ts";
import { computeSHA1, test_url, writeToTestOutput } from "../test_util.ts";

Deno.test("Download Instagram video", async () => {
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

  await writeToTestOutput(videoBytes, `ig_video.mp4`);

  assertEquals(
    videoBytes.byteLength,
    1_134_110,
    "video length matches",
  );

  assertEquals(
    await computeSHA1(videoBytes),
    "1e7e1f508c2bf0540b95b30d9c1b674209ff3001",
    "video hash matches",
  );
});
