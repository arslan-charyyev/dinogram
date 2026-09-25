import { assert, assertEquals, assertRejects } from "@std/assert";
import { ExternalMediaError } from "../../src/client/platform-client.ts";
import { PinterestClient } from "../../src/client/pinterest-client.ts";
import { messages } from "../../src/core/messages.ts";
import type { MediaFile, SingleMediaFile } from "../../src/model/file.ts";
import { test_url } from "../test_util.ts";

// These tests talk to Pinterest. The pins are public, so no login is needed.

async function fetchPost(url: string) {
  return await new PinterestClient(new URL(url)).fetchPost();
}

/**
 * Downloads the first bytes of the file and checks its type
 */
async function assertFile(file: SingleMediaFile) {
  const response = await fetch(file.downloadUrl, {
    headers: { Range: "bytes=0-15" },
  });
  assert(response.ok, `${file.downloadUrl} is fetched`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder().decode(bytes);

  switch (file.type) {
    case "video":
      assertEquals(text.slice(4, 8), "ftyp", "the video is an MP4 file");
      break;
    case "photo":
      assert(
        (bytes[0] === 0xff && bytes[1] === 0xd8) ||
          (bytes[0] === 0x89 && text.slice(1, 4) === "PNG"),
        "the photo is a JPEG or PNG file",
      );
      break;
    case "animation":
      assertEquals(text.slice(0, 3), "GIF", "the animation is a GIF file");
      break;
  }
}

Deno.test("Download Pinterest image", async () => {
  const post = await fetchPost(test_url.pinterest.image);
  assert(post.type === "single" && post.file.type === "photo", "one photo");
  assertEquals(post.description, "Red Rock Point");
  assert(post.file.downloadUrl.includes("/originals/"), "the original size");
  await assertFile(post.file);
});

Deno.test("Download Pinterest image in full size", async () => {
  const post = await fetchPost(test_url.pinterest.high_res);
  assert(post.type === "single" && post.file.type === "photo", "one photo");
  assert(post.file.downloadUrl.includes("/originals/"), "the original size");
  await assertFile(post.file);
});

Deno.test("Download Pinterest image above the Telegram photo limit", async () => {
  const post = await fetchPost(test_url.pinterest.oversized);
  assert(post.type === "single" && post.file.type === "photo", "one photo");
  assert(post.file.downloadUrl.includes("/1200x/"), "the 1200 px copy");
  await assertFile(post.file);
});

Deno.test("Download Pinterest image from a regional domain", async () => {
  const post = await fetchPost(test_url.pinterest.regional_image);
  assert(post.type === "single" && post.file.type === "photo", "one photo");
  await assertFile(post.file);
});

Deno.test("Download Pinterest video", async () => {
  const post = await fetchPost(test_url.pinterest.video);
  assert(post.type === "single" && post.file.type === "video", "one video");
  await assertFile(post.file);
});

Deno.test("Download Pinterest story video", async () => {
  const post = await fetchPost(test_url.pinterest.story_video);
  assert(post.type === "single" && post.file.type === "video", "one video");
  await assertFile(post.file);
});

Deno.test("Download Pinterest video that the API lists only as HLS", async () => {
  const post = await fetchPost(test_url.pinterest.hls_only_video);
  assert(post.type === "single" && post.file.type === "video", "one video");
  assert(post.file.downloadUrl.endsWith(".mp4"), "the MP4 from the pin page");
  await assertFile(post.file);
});

Deno.test("Download Pinterest multi-page pin", async () => {
  const post = await fetchPost(test_url.pinterest.multi_page);
  assert(post.type === "multi", "several files");
  assertEquals(post.files.length, 3);
  assert(post.files.every((it: MediaFile) => it.type === "photo"));
  await assertFile(post.files[0]);
});

Deno.test("Download Pinterest carousel", async () => {
  const post = await fetchPost(test_url.pinterest.carousel);
  assert(post.type === "multi", "several files");
  assert(post.files.length > 1, "more than one image");
  assert(
    post.files[0].downloadUrl.includes("/originals/"),
    "the original size, not the 736 px preview",
  );
  await assertFile(post.files[0]);
});

Deno.test("Download Pinterest GIF", async () => {
  const post = await fetchPost(test_url.pinterest.gif);
  assert(post.type === "single" && post.file.type === "animation", "a GIF");
  await assertFile(post.file);
});

Deno.test("Download Pinterest short link", async () => {
  const post = await fetchPost(test_url.pinterest.short_link);
  assert(post.type === "single" && post.file.type === "video", "one video");
});

Deno.test("Pinterest pin of a Vimeo video names the video", async () => {
  const error = await assertRejects(
    () => fetchPost(test_url.pinterest.vimeo),
    ExternalMediaError,
  );
  assertEquals(error.url.toString(), "https://vimeo.com/111691128");
});

Deno.test("Pinterest pin that is gone", async () => {
  await assertRejects(
    () => fetchPost(test_url.pinterest.not_found),
    Error,
    messages.PINTEREST_NOT_FOUND,
  );
});

Deno.test("Pinterest short link to a board", async () => {
  await assertRejects(
    () => fetchPost(test_url.pinterest.short_link_to_board),
    Error,
    messages.PINTEREST_NOT_A_PIN,
  );
});
