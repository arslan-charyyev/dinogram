import { DOMParser, HTMLDocument } from "@b-fuze/deno-dom";
import { retry } from "@std/async/retry";
import { JSONPath } from "jsonpath-plus";
import z from "zod";
import { log } from "../core/log.ts";
import { AuthMode } from "../model/auth-mode.ts";
import { FileBuilder, type MediaFile } from "../model/file.ts";
import { FilePost, PostBuilder } from "../model/post.ts";
import { instagramDb } from "../platforms/instagram/instagram-db.ts";
import { getPathSegments, runAfter } from "../core/utils.ts";
import { PlatformClient } from "./platform-client.ts";
import { randomInt } from "node:crypto";
import {
  cookiesHaveInstagramLoginData,
} from "../platforms/instagram/instagram-browser.ts";
import { getBrowserInstance } from "../core/browser.ts";

export class InstagramClient extends PlatformClient {
  // Would be better to extract this Doc IDs dynamically
  private static IG_APP_ID = "936619743392459";

  override name = "Instagram";

  constructor(pageUrl: URL) {
    super(pageUrl);

    this.fetch = async (input, init) => {
      const headers: HeadersInit = {
        // Without this full set of headers,
        // response body sometimes lacks required data.
        "accept": "text/html,application/json,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.6",
        "cache-control": "no-cache",
        "pragma": "no-cache",
        "priority": "u=0, i",
        "sec-ch-ua":
          '"Chromium";v="136", "Brave";v="136", "Not.A/Brand";v="99"',
        "sec-ch-ua-full-version-list":
          '"Chromium";v="136.0.0.0", "Brave";v="136.0.0.0", "Not.A/Brand";v="99.0.0.0"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-model": '""',
        "sec-ch-ua-platform": '"Linux"',
        "sec-ch-ua-platform-version": '"6.6.88"',
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "none",
        "sec-fetch-user": "?1",
        "sec-gpc": "1",
        "upgrade-insecure-requests": "1",
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      };

      // const cookieString = await db.instagram.cookie.get();
      // if (cookieString) {
      //   headers["cookie"] = cookieString;
      //   headers["x-ig-app-id"] = InstagramClient.IG_APP_ID;
      //   const jar = new AppCookieJar(cookieString);
      //   const csrftoken = jar.get("csrftoken");
      //   if (csrftoken) {
      //     headers["x-csrftoken"] = csrftoken;
      //   }
      // }

      const res = await fetch(input, {
        referrerPolicy: "strict-origin-when-cross-origin",
        ...init,
        headers: {
          ...headers,
          ...init?.headers,
        },
      });

      // if (cookieString) {
      //   const jar = new AppCookieJar(cookieString);
      //   jar.replaceCookies(res.headers.getSetCookie());
      //   await db.instagram.cookie.set(jar.getCookieString());
      // }

      return res;
    };
  }

  /**
   * It would appear that there two ways to fetch data,
   * depending on authentication status of the client.
   */
  override async fetchPost(): Promise<FilePost> {
    const mediaInfo = await this.fetchMediaInfo();

    const mediaItem = mediaInfo.items[0];

    const description = mediaItem.caption?.text ?? "";
    const pageUrl = this.pageUrl;

    switch (mediaItem.media_type) {
      case MediaType.Image: {
        const file = createMediaFile(mediaItem);

        return PostBuilder.single({ description, pageUrl, file });
      }
      case MediaType.Video: {
        const file = createMediaFile(mediaItem);

        return PostBuilder.single({ description, pageUrl, file });
      }
      case MediaType.Carousel: {
        const files = mediaItem.carousel_media.map((media) => {
          switch (media.media_type) {
            case MediaType.Image: {
              return createMediaFile(media);
            }
            case MediaType.Video: {
              return createMediaFile(media);
            }
          }
        });

        return PostBuilder.multi({ description, pageUrl, files });
      }
    }
  }

  private async fetchMediaInfo(): Promise<
    z.infer<typeof MediaInfoSchema>
  > {
    const authMode = await instagramDb.authMode.getOrDef();

    switch (authMode) {
      case AuthMode.Anonymous:
        // Sometimes it takes a few tries to anonymously fetch media info
        return retry(() => this.fetchMediaInfoAnonymously());
      case AuthMode.Authenticated:
        return this.fetchMediaInfoAuthenticated();
    }
  }

  private async fetchMediaInfoAuthenticated(): Promise<
    z.infer<typeof MediaInfoSchema>
  > {
    const browser = await getBrowserInstance();
    const cookies = await browser.cookies();

    if (cookiesHaveInstagramLoginData(cookies)) {
      throw new Error(
        "No Instagram login data found. " +
          "Ask bot admin to login via bot settings.",
      );
    }

    const page = await browser.newPage();
    try {
      const res = await page.goto(this.pageUrl.toString());
      if (!res) throw new Error(`Failed to open page: ${this.pageUrl}`);

      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");

      // TODO: Check content. possible cases:
      // 1. [x] Content available (proceed)
      // 2. [ ] Anti-scraping challenge (bypass, proceed)
      // 3. [ ] Captcha powered anti-scraping challenge (prompt user, proceed)

      const mediaInfoJson = this.extractMediaInfoAuthenticated(doc);

      const mediaInfo = MediaInfoSchema.safeParse(mediaInfoJson);

      if (!mediaInfo.success) {
        throw new Error(
          "Failed to parse media info",
          { cause: mediaInfo.error },
        );
      }

      return mediaInfo.data;
    } catch (e) {
      throw e;
    } finally {
      // Close the page after 1-3s
      runAfter({
        seconds: randomInt(1, 3),
        callback: page.close,
      });
    }
  }

  private async fetchMediaInfoAnonymously(): Promise<
    z.infer<typeof MediaInfoSchema>
  > {
    // Fetch post's html document

    const res = await this.fetch(this.pageUrl);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");

    // TODO: Check if login is needed and inform user about that

    const mediaInfoJson = this.extractMediaInfoAnonymously(doc);

    const mediaInfo = MediaInfoSchema.safeParse(mediaInfoJson);

    if (!mediaInfo.success) {
      throw new Error("Failed to parse media info", { cause: mediaInfo.error });
    }

    return mediaInfo.data;
  }

  private async extractMediaInfoAuthenticated(
    doc: HTMLDocument,
  ): Promise<unknown> {
    // Find media info URL

    // Example:
    // <meta property="al:ios:url" content="instagram://media?id=3445445944417076601" />
    const metaElement = doc.querySelector('head > meta[property="al:ios:url"]');
    if (!metaElement) {
      throw new Error("Invalid link. Meta property al:ios:url not found.");
    }

    const metaContent = metaElement.getAttribute("content");
    if (!metaContent) throw new Error("Meta content not found");

    const metaUrl = new URL(metaContent);
    const mediaId = metaUrl.searchParams.get("id");
    if (!mediaId) throw new Error(`Media ID not found in Meta URL ${metaUrl}`);

    const mediaInfoUrl = new URL(
      `https://www.instagram.com/api/v1/media/${mediaId}/info/`,
    );

    // Fetch media info
    try {
      // FIXME: Use browser instead of fetch
      const res = await this.fetch(mediaInfoUrl);
      return res.json();
    } catch (cause) {
      throw new Error("Failed to fetch media info", { cause });
    }
  }

  private extractMediaInfoAnonymously(
    doc: HTMLDocument,
  ): Promise<unknown> {
    const scripts = doc.querySelectorAll(
      'script[type="application/json"][data-sjs]',
    );

    const key = "xdt_api__v1__media__shortcode__web_info";

    for (const script of scripts) {
      if (!script.textContent.includes(key)) continue;

      const json = JSON.parse(script.textContent);
      const mediaInfoJson = JSONPath({ path: `\$..['${key}']`, json })[0];

      return mediaInfoJson;
    }

    throw new Error("No media info data found");
  }

  private async fetchWithBypass(
    url: URL,
    authenticated: boolean,
    attemptsLeft: number = 3,
  ): Promise<Response> {
    if (attemptsLeft <= 0) {
      throw new Error("Failed to fetch with bypass");
    }

    const res = await this.fetch(url);

    // Check if we ran into challenge request and attempt to bypass it
    if (
      res.redirected && getPathSegments(new URL(res.url))[0] === "challenge"
    ) {
      if (!authenticated) {
        throw new Error("Unexpected anonymous challenge request");
      }

      const success = await this.bypassScrapingChallenge();
      if (!success) {
        throw new Error("Failed to bypass scraping challenge");
      }

      log.info("Attempted to bypass Instagram challenge");

      return this.fetchWithBypass(url, authenticated, attemptsLeft - 1);
    } else {
      return res;
    }
  }

  /**
   * Attempts to pass scraping challenge.
   * In practice, this only works a few times,
   * before Instagram starts requiring Captcha.
   *
   * @returns boolean indicating if bypass was successful
   */
  private async bypassScrapingChallenge() {
    const challengeRes = await this.fetch(
      // Not sure if the __coig_challenged param is required
      "https://www.instagram.com/api/v1/challenge/web/?__coig_challenged=1",
    );

    const challengeJson = await challengeRes.json();
    const challengeContext = challengeJson.challenge_context;

    const takeChallengeRes = await this.fetch(
      "https://www.instagram.com/api/v1/bloks/apps/com.instagram.challenge.navigation.take_challenge/",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          challenge_context: challengeContext,
          // Not sure if these are required
          has_follow_up_screens: "false",
          nest_data_manifest: "true",
        }),
        // Not sure if these are required
        "referrer": this.pageUrl.toString(),
        "referrerPolicy": "strict-origin-when-cross-origin",
        "credentials": "include",
      },
    );

    return takeChallengeRes.ok;
  }

  static override supportsLink(url: URL): boolean {
    const pathSegments = getPathSegments(url);

    return (
      url.hostname.endsWith("instagram.com") &&
      (pathSegments.includes("reel") || pathSegments.includes("p"))
    );
  }
}

enum MediaType {
  Image = 1,
  Video = 2,
  Carousel = 8,
}

const MediaCaptionSchema = z.object({
  text: z.string(),
});

const MediaItem = z.object({
  url: z.string().url(),
  width: z.number().int(),
  height: z.number().int(),
});

const MediaSchema = z.object({
  original_width: z.number().int(),
  original_height: z.number().int(),
});

const ImageMediaSchema = MediaSchema.extend({
  media_type: z.literal(MediaType.Image),
  caption: MediaCaptionSchema.nullish(),
  image_versions2: z.object({
    candidates: z.array(MediaItem),
  }),
});

const VideoMediaSchema = MediaSchema.extend({
  media_type: z.literal(MediaType.Video),
  caption: MediaCaptionSchema.nullish(),
  video_versions: z.array(MediaItem),
});

const CarouselMediaSchema = z.object({
  media_type: z.literal(MediaType.Carousel),
  caption: MediaCaptionSchema.nullish(),
  carousel_media: z.array(
    z.discriminatedUnion("media_type", [ImageMediaSchema, VideoMediaSchema]),
  ),
});

const MediaInfoSchema = z.object({
  items: z.array(
    z.discriminatedUnion("media_type", [
      ImageMediaSchema,
      VideoMediaSchema,
      CarouselMediaSchema,
    ]),
  ),
});

function findBestCandidate(
  media: z.infer<typeof MediaSchema>,
  candidates: z.infer<typeof MediaItem>[],
): z.infer<typeof MediaItem> {
  const originalCandidate = candidates.find(
    (candidate) =>
      candidate.height === media.original_height &&
      candidate.width === media.original_width,
  );

  return originalCandidate ?? candidates[0];
}

function createMediaFile(
  media: z.infer<typeof ImageMediaSchema> | z.infer<typeof VideoMediaSchema>,
): MediaFile {
  switch (media.media_type) {
    case MediaType.Image: {
      const bestCandidate = findBestCandidate(
        media,
        media.image_versions2.candidates,
      );

      return FileBuilder.photo({ downloadUrl: bestCandidate.url });
    }
    case MediaType.Video: {
      const bestCandidate = findBestCandidate(media, media.video_versions);

      return FileBuilder.video({ downloadUrl: bestCandidate.url });
    }
  }
}
