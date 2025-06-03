import { AsyncValue } from "@core/asyncutil/async-value";
import { Lock } from "@core/asyncutil/lock";
import { Cookie } from "puppeteer";
import { VNCBrowser } from "../../core/vnc-browser.ts";
import { arraysAreEqual, getPathSegments, runAfter } from "../../core/utils.ts";
import { logger } from "../../core/logging.ts";

const LOGIN_COOKIES = ["ds_user_id", "sessionid"];

/**
 * @returns a URL that the user should open on his device to proceed with login
 */
export async function startInstagramBrowserLoginFlow(args: {
  onSuccess: () => void;
  onExpire: () => void;
}): Promise<URL> {
  const browser = await VNCBrowser.new();
  const page = await browser.newPage();

  // Close after 1 hour
  // TODO: This needs to be tested at least once
  const closePageId = runAfter({
    seconds: 3600,
    callback: async () => {
      try {
        await browser.close();
        args.onExpire();
      } catch (error) {
        logger.error`Failed to close page after expiry: ${error}`;
      }
    },
  });

  const loginUrl = new URL("https://www.instagram.com/accounts/login");
  loginUrl.searchParams.append(
    "next",
    "https://www.instagram.com/accounts/edit",
  );
  page.goto(loginUrl.toString(), { timeout: 3600 * 1000 });

  // TODO: framenavigated event is too broad,
  // would be better to find something more specific
  const completedLock = new Lock(new AsyncValue(false));
  page.on("framenavigated", async (frame) => {
    // A new page has been opened
    let newUrl: URL;
    try {
      newUrl = new URL(frame.url());
    } catch (_e) {
      // Sometimes we get URLs with just ":". Hence, we ignore them.
      return;
    }

    if (!urlMatchesAccountSettings(newUrl)) return;

    // Account settings page has been opened
    const cookies = await browser.cookies();

    if (!cookiesHaveInstagramLoginData(cookies)) return;

    // Login cookies are present. Enter critical section.
    await completedLock.lock(async (completedAsync) => {
      const completed = await completedAsync.get();
      if (completed) return;

      await completedAsync.set(true);

      logger.info`Instagram login successful`;

      clearTimeout(closePageId);

      // Copy new cookies to existing global browser instance
      const globalBrowser = await VNCBrowser.instance();
      await globalBrowser.setCookie(...cookies);

      await browser.close();

      args.onSuccess();
    });
  });

  const frontendURL = await browser.startVncServer();

  return frontendURL;
}

export async function clearInstagramLoginData() {
  const browser = await VNCBrowser.instance();

  logger.info`Clearing Instagram login data`;

  const cookies = await getInstagramLoginCookies();
  await browser.deleteCookie(...cookies);
}

export async function getInstagramLoginCookies() {
  const browser = await VNCBrowser.instance();
  const cookies = await browser.cookies();

  return cookies.filter((cookie) =>
    cookie.domain.endsWith("instagram.com") &&
    LOGIN_COOKIES.includes(cookie.name)
  );
}

export function cookiesHaveInstagramLoginData(cookies: Cookie[]) {
  return LOGIN_COOKIES.map((name) =>
    cookies.find((cookie) =>
      cookie.domain.endsWith("instagram.com") &&
      cookie.name === name
    )
  ).every(Boolean);
}

function urlMatchesAccountSettings(url: URL) {
  const pathSegments = getPathSegments(url);
  const targetSegments = ["accounts", "edit"];

  return url.hostname.endsWith("instagram.com") &&
    arraysAreEqual(pathSegments, targetSegments);
}
