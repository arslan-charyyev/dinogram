import { assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import {
  allItemsPayload,
  linkId,
  parseAllItemsPayload,
} from "../src/bot/deep-link.ts";

const postUrl = new URL(
  "https://www.tiktok.com/@melkwegamsterdam/photo/7120615642583158021",
);

Deno.test("All items payload fits a start parameter", async () => {
  const payload = allItemsPayload(await linkId(postUrl));

  assertMatch(payload, /^[A-Za-z0-9_-]{1,64}$/, "payload is a valid start");
});

Deno.test("Link ID names the same link every time", async () => {
  const first = await linkId(postUrl);
  const second = await linkId(new URL(postUrl.toString()));
  const other = await linkId(new URL("https://pin.it/42pZ430rg"));

  assertEquals(first, second, "same link gives the same ID");
  assertNotEquals(first, other, "another link gives another ID");
});

Deno.test("All items payload parses back to its ID", async () => {
  const id = await linkId(postUrl);

  assertEquals(parseAllItemsPayload(allItemsPayload(id)), id, "ID comes back");
});

Deno.test("Other start payloads are not all items payloads", () => {
  for (
    const payload of ["", "inline", "all-", "all-XYZ", `all-${"a".repeat(33)}`]
  ) {
    assertEquals(
      parseAllItemsPayload(payload),
      null,
      `"${payload}" is refused`,
    );
  }
});
