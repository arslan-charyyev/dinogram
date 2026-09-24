import { assertEquals } from "@std/assert";
import { YouTubeClient } from "../../src/client/youtube-client.ts";

const video = (id: string, isShort = false) => ({ type: "video", id, isShort });
const playlist = { type: "playlist" };

const cases: [string, unknown][] = [
  ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", video("dQw4w9WgXcQ")],
  ["https://youtube.com/watch?v=dQw4w9WgXcQ&t=42", video("dQw4w9WgXcQ")],
  ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", video("dQw4w9WgXcQ")],
  ["https://music.youtube.com/watch?v=dQw4w9WgXcQ", video("dQw4w9WgXcQ")],
  ["https://youtu.be/dQw4w9WgXcQ?si=abc", video("dQw4w9WgXcQ")],
  ["https://www.youtube.com/shorts/BGQWPY4IigY", video("BGQWPY4IigY", true)],
  ["https://www.youtube.com/live/dQw4w9WgXcQ", video("dQw4w9WgXcQ")],
  ["https://www.youtube.com/embed/dQw4w9WgXcQ", video("dQw4w9WgXcQ")],
  ["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", video("dQw4w9WgXcQ")],
  // A video in a playlist is still one video
  [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123",
    video("dQw4w9WgXcQ"),
  ],
  ["https://www.youtube.com/playlist?list=PL123", playlist],
  ["https://www.youtube.com/@RickAstleyYT", null],
  ["https://www.youtube.com/watch?v=too-short", null],
  ["https://notyoutube.com/watch?v=dQw4w9WgXcQ", null],
  ["https://www.tiktok.com/@user/video/1", null],
];

for (const [url, expected] of cases) {
  Deno.test(`YouTube link ${url}`, () => {
    assertEquals(YouTubeClient.parseLink(new URL(url)), expected);
  });
}
