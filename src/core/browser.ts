import { resolve } from "@std/path";
import memoizee from "memoizee";
import puppeteer from "puppeteer";
import { config } from "./config.ts";
import { log } from "./log.ts";

export const getBrowserInstance = memoizee(
  launchBrowser,
  { promise: true },
);

async function launchBrowser(args: string[] = []) {
  log.debug("Launching browser...");

  const userDataDir = config.DATA_DIR
    ? resolve(config.DATA_DIR, "chrome-data")
    : undefined;

  if (userDataDir) {
    // Attempt to clear lock files left over from previous crashes
    for (const file of ["ProcessSingleton", "SingletonLock"]) {
      const path = resolve(userDataDir, file);
      try {
        // Some of the files are symlinks, and checking their existence is cumbersome
        await Deno.remove(path);
      } catch (_) { /* ignore */ }
    }
  }

  const browser = await puppeteer.launch({
    args: ["--hide-crash-restore-bubble", ...args],
    headless: false, // We will want to stream the UI
    userDataDir: userDataDir,
    defaultViewport: null,
    // defaultViewport: { width: 1280, height: 720 },
  });

  log.debug(`Browser launched: ${await browser.version()}`);

  return browser;
}
