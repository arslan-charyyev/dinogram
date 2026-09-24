import { assertEquals } from "@std/assert";
import { parseYouTubeCookies } from "../src/utils/netscape-cookies.ts";

Deno.test("YouTube cookies keep tabs and the HttpOnly lines", () => {
  const text = [
    "# Netscape HTTP Cookie File",
    "# This is a generated file! Do not edit.",
    "",
    ".youtube.com\tTRUE\t/\tTRUE\t1790000000\tSID\tabc",
    "#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t1790000000\tHSID\tdef",
  ].join("\n");

  assertEquals(
    parseYouTubeCookies(text),
    [
      "# Netscape HTTP Cookie File",
      ".youtube.com\tTRUE\t/\tTRUE\t1790000000\tSID\tabc",
      "#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t1790000000\tHSID\tdef",
      "",
    ].join("\n"),
  );
});

Deno.test("YouTube cookies survive tabs that turned into spaces", () => {
  // Some Telegram clients replace a tab with spaces
  const text = ".youtube.com  TRUE  /  TRUE  1790000000  SID  abc";

  assertEquals(
    parseYouTubeCookies(text),
    "# Netscape HTTP Cookie File\n" +
      ".youtube.com\tTRUE\t/\tTRUE\t1790000000\tSID\tabc\n",
  );
});

Deno.test("YouTube cookies need a youtube.com cookie", () => {
  assertEquals(
    parseYouTubeCookies(".google.com\tTRUE\t/\tTRUE\t1790000000\tSID\tabc"),
    undefined,
  );
  assertEquals(parseYouTubeCookies("not a cookie file"), undefined);
});
