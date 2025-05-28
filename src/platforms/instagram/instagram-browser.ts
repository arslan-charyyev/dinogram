import { AsyncValue } from "@core/asyncutil/async-value";
import { Lock } from "@core/asyncutil/lock";
import { Cookie } from "puppeteer";
import { getBrowserInstance } from "../../core/browser.ts";
import { log } from "../../core/log.ts";
import { arraysAreEqual, getPathSegments, runAfter } from "../../core/utils.ts";

enum InstagramLoginCookie {
  DsUserId = "ds_user_id",
  SessionId = "sessionid",
}
/**
 * @returns a URL that the user should open on his device
 */
export async function startInstagramBrowserLoginFlow(
  args: { onSuccess: () => void },
): Promise<URL> {
  const browser = await getBrowserInstance();
  const page = await browser.newPage();

  // Close after 1 hour
  const closePageId = runAfter({ seconds: 3600, callback: page.close });

  page.goto(
    "https://www.instagram.com/accounts/login/?next=https%3A%2F%2Fwww.instagram.com%2Faccounts%2Fedit",
    { timeout: 3600 * 1000 },
  );

  const completedLock = new Lock(new AsyncValue(false));
  page.on("framenavigated", async (frame) => {
    // A new page has been opened
    let newUrl: URL;
    try {
      newUrl = new URL(frame.url());
    } catch (_e) {
      // Sometimes we get urls with just ":". Hence, we ignore them.
      return;
    }

    if (urlMatchesAccountSettings(newUrl)) {
      // Account settings page has been opened
      const cookies = await browser.cookies();

      if (cookiesHaveInstagramLoginData(cookies)) {
        // Login cookies are present. Enter critical section.

        await completedLock.lock(async (completedAsync) => {
          const completed = await completedAsync.get();
          if (completed) return;

          await completedAsync.set(true);

          log.info("Instagram login successful");

          await page.close();
          clearTimeout(closePageId);

          args.onSuccess();
        });
      }
    }
  });

  // TODO: x11vnc + novnc
  const url = new URL("https://todo.dev/instagram-login");

  return url;
}

export async function clearInstagramLoginData() {
  const browser = await getBrowserInstance();

  log.info("Clearing Instagram login data");

  const cookies = await getInstagramLoginCookies();
  for (const cookie of cookies) {
    await browser.deleteCookie(cookie);
  }
}

export async function getInstagramLoginCookies() {
  const browser = await getBrowserInstance();
  const cookies = await browser.cookies();

  return cookies.filter((cookie) =>
    cookie.domain.endsWith("instagram.com") &&
    Object.values(InstagramLoginCookie).includes(cookie.name as never)
  );
}

export function cookiesHaveInstagramLoginData(cookies: Cookie[]) {
  return Object.values(InstagramLoginCookie)
    .map((name) =>
      cookies.find((cookie) =>
        cookie.domain.endsWith("instagram.com") &&
        cookie.name === name
      )
    )
    .every(Boolean);
}

function urlMatchesAccountSettings(url: URL) {
  const pathSegments = getPathSegments(url);
  const targetSegments = ["accounts", "edit"];

  return url.hostname.endsWith("instagram.com") &&
    arraysAreEqual(pathSegments, targetSegments);
}
