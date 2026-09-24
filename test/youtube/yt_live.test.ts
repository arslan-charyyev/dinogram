import { assert, assertEquals } from "@std/assert";
import { YouTubeClient } from "../../src/client/youtube-client.ts";
import { config } from "../../src/core/config.ts";
import { Downloads } from "../../src/core/downloads.ts";

// This test talks to YouTube through yt-dlp, which CI does not install. It
// runs where the binary exists, such as a development machine with yt-dlp.
async function isYtDlpAvailable(): Promise<boolean> {
  try {
    const { success } = await new Deno.Command(config.YT_DLP_PATH, {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    }).output();
    return success;
  } catch (_e) {
    // Deno throws right away when the binary does not exist
    return false;
  }
}

const hasYtDlp = await isYtDlpAvailable();

Deno.test({
  name: "Download YouTube audio",
  ignore: !hasYtDlp,
  async fn() {
    await Downloads.init();

    const video = await YouTubeClient.fetchVideo("BGQWPY4IigY");
    assert(video.isShort, "YouTube reports the video as a Short");

    const option = video.audioOptions.at(-1);
    assert(option, "the video has an audio option");

    const file = await YouTubeClient.download(video, option, () => {});

    try {
      assert(file.path.endsWith(".m4a"), "the audio is M4A");
      assertEquals(file.size > 50_000, true, "the audio has content");
    } finally {
      await file.cleanup();
    }
  },
});
