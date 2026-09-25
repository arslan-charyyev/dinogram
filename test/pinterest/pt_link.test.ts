import { assertEquals } from "@std/assert";
import { PinterestClient } from "../../src/client/pinterest-client.ts";

const cases: [string, boolean][] = [
  ["https://www.pinterest.com/pin/858146903966145189/", true],
  ["https://pinterest.com/pin/some-title--2885187256207927", true],
  ["https://de.pinterest.com/pin/858146903966145189/", true],
  ["https://www.pinterest.co.uk/pin/858146903966145189/", true],
  ["https://pin.it/42pZ430rg", true],
  // Boards and profiles pass here, so the bot can say that they are not pins
  ["https://www.pinterest.com/g1952849/test-/", true],
  ["https://www.pinterest.com/", false],
  ["https://pin.it/", false],
  ["https://notpinterest.com/pin/858146903966145189/", false],
];

for (const [url, expected] of cases) {
  Deno.test(`Pinterest link ${url}`, () => {
    assertEquals(PinterestClient.supportsLink(new URL(url)), expected);
  });
}
