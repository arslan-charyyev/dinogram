import { assertEquals } from "@std/assert";
import { mainWarning } from "../../src/client/yt-dlp.ts";

Deno.test("yt-dlp warnings: the sign-in wall wins over the generic ones", () => {
  // Real stderr of a probe from a server that YouTube distrusts
  const warnings = [
    "WARNING: [youtube] No title found in player responses; falling back to title from initial data. Other metadata may also be missing",
    "WARNING: [youtube] Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication.",
    "WARNING: No video formats found!",
    "WARNING: Requested format is not available",
  ].join("\n");

  assertEquals(
    mainWarning(warnings),
    "Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication.",
  );
});

Deno.test("yt-dlp warnings: generic warnings alone give no cause", () => {
  assertEquals(
    mainWarning(
      "WARNING: No video formats found!\nWARNING: Requested format is not available",
    ),
    undefined,
  );
});
