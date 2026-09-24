import { assertEquals } from "@std/assert";
import {
  hasMediaFormats,
  type OptionLimits,
  selectOptions,
  VideoInfo,
} from "../../src/client/youtube-formats.ts";

const MB = 1024 * 1024;

const noLimits: OptionLimits = {
  maxBytes: 1950 * MB,
  maxVideoSeconds: 120 * 60,
  maxAudioSeconds: 180 * 60,
};

// The fixtures are yt-dlp probes of real videos, cut to the fields that the
// selection reads
async function fixture(name: string): Promise<VideoInfo> {
  const url = new URL(`./fixtures/${name}.json`, import.meta.url);
  return VideoInfo.parse(JSON.parse(await Deno.readTextFile(url)));
}

Deno.test("YouTube options: H.264 video up to 1080p, AAC audio", async () => {
  const { videoOptions, audioOptions } = selectOptions(
    await fixture("music_video"),
    noLimits,
  );

  assertEquals(
    videoOptions.map((it) => [it.label, it.formatId]),
    [
      ["1080p", "137+140"],
      ["720p", "136+140"],
      ["480p", "135+140"],
      ["360p", "134+140"],
    ],
    "the four largest H.264 sizes, each with the AAC audio",
  );

  assertEquals(
    audioOptions.map((it) => [it.label, it.formatId]),
    [["130 kbps", "140"], ["49 kbps", "139"]],
  );

  assertEquals(
    videoOptions[0].size,
    80_911_999 + 3_449_447,
    "a video size includes its audio",
  );
});

Deno.test("YouTube options: the original track of a dubbed video", async () => {
  const { videoOptions, audioOptions } = selectOptions(
    await fixture("dubbed_video"),
    noLimits,
  );

  assertEquals(
    audioOptions.map((it) => it.formatId),
    ["140-23", "139-23"],
    "the English original, not one of the 23 dubs",
  );
  assertEquals(videoOptions[0].formatId, "137+140-23");
});

Deno.test("YouTube options: the plain track of a Short, not the DRC one", async () => {
  const { videoOptions, audioOptions } = selectOptions(
    await fixture("short"),
    noLimits,
  );

  assertEquals(audioOptions.map((it) => it.formatId), ["140", "139"]);
  assertEquals(videoOptions[0].formatId, "137+140");
  assertEquals([videoOptions[0].width, videoOptions[0].height], [608, 1080]);
});

Deno.test("YouTube options: sizes above the upload limit are dropped", async () => {
  const { videoOptions, audioOptions } = selectOptions(
    await fixture("music_video"),
    { ...noLimits, maxBytes: 49 * MB },
  );

  assertEquals(
    videoOptions.map((it) => it.label),
    ["720p", "480p", "360p", "240p"],
    "1080p is gone, and 240p takes its place in the four",
  );
  assertEquals(audioOptions.length, 2);
});

Deno.test("YouTube options: length limits apply per kind", async () => {
  // The dubbed video is 1541 s long
  const { videoOptions, audioOptions } = selectOptions(
    await fixture("dubbed_video"),
    { ...noLimits, maxVideoSeconds: 20 * 60 },
  );

  assertEquals(videoOptions, [], "too long for a video");
  assertEquals(audioOptions.length, 2, "short enough for an audio");
});

Deno.test("YouTube options: a long video keeps the small sizes that fit", async () => {
  // The four largest sizes of the dubbed video are all above 49 MB
  const { videoOptions } = selectOptions(
    await fixture("dubbed_video"),
    { ...noLimits, maxBytes: 49 * MB },
  );

  assertEquals(videoOptions.map((it) => it.label), ["144p"]);
});

Deno.test("YouTube options: storyboards alone are no media", async () => {
  const info = await fixture("music_video");
  const storyboards = info.formats!.filter((it) => it.protocol === "mhtml");

  assertEquals(storyboards.length > 0, true, "the fixture has storyboards");
  assertEquals(hasMediaFormats(info), true);
  assertEquals(hasMediaFormats({ ...info, formats: storyboards }), false);
});
