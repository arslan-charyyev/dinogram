import { DOMParser, HTMLDocument } from "@b-fuze/deno-dom";
import { JSONPath } from "jsonpath-plus";
import z from "zod";
import { db } from "../core/db.ts";
import { log } from "../core/log.ts";
import { FileBuilder } from "../model/file.ts";
import { FilePost, PostBuilder } from "../model/post.ts";
import { AppCookieJar } from "../utils/app-cookie-jar.ts";
import { getUrlSegments } from "../utils/utils.ts";
import { PlatformClient } from "./platform-client.ts";
import { retry } from "@std/async";

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
        "accept":
          "text/html,application/json,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
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

      const cookieString = await db.instagram.cookie.get();
      if (cookieString) {
        headers["cookie"] = cookieString;
        headers["x-ig-app-id"] = InstagramClient.IG_APP_ID;
        const jar = new AppCookieJar(cookieString);
        const csrftoken = jar.get("csrftoken");
        if (csrftoken) {
          headers["x-csrftoken"] = csrftoken;
        }
      }

      const res = await fetch(input, {
        referrerPolicy: "strict-origin-when-cross-origin",
        ...init,
        headers: {
          ...headers,
          ...init?.headers,
        },
      });

      if (cookieString) {
        const jar = new AppCookieJar(cookieString);
        jar.replaceCookies(res.headers.getSetCookie());
        await db.instagram.cookie.set(jar.getCookieString());
      }

      return res;
    };
  }

  override async fetchPost(): Promise<FilePost> {
    const hasCookie = !!await db.instagram.cookie.get();

    if (hasCookie) {
      try {
        return this.fetchPostImpl(true);
      } catch (error) {
        log.error(
          "Failed to fetch instagram post with authentication. " +
            "Now trying anonymously. Error: ",
          error,
        );
      }
    }

    return this.fetchPostImpl(false);
  }

  /**
   * It would appear that there two ways to fetch data,
   * depending on authentication status of the client.
   */
  private async fetchPostImpl(authenticated: boolean): Promise<FilePost> {
    const mediaInfo = await retry(() => this.fetchMediaInfo(authenticated));
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

  private async fetchMediaInfo(
    authenticated: boolean,
  ): Promise<z.infer<typeof MediaInfoSchema>> {
    // Fetch post's html document

    const res = await this.fetchWithBypass(this.pageUrl, authenticated);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");

    const mediaInfoJson = authenticated
      ? await this.extractMediaInfoAuthenticated(doc)
      : this.extractMediaInfoAnonymously(doc);

    // Parse media info

    const mediaInfo = MediaInfoSchema.safeParse(mediaInfoJson);

    if (!mediaInfo.success) {
      throw new Error("Failed to fetch media info");
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
    if (!metaElement) throw new Error("Meta property al:ios:url not found");

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
      const res = await this.fetchWithBypass(mediaInfoUrl, true);
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
    if (res.redirected && getUrlSegments(new URL(res.url))[0] === "challenge") {
      if (!authenticated) {
        throw new Error("Unexpected anonymous challenge request");
      }

      const success = await this.bypassScrapingChallenge();
      if (!success) {
        throw new Error("Failed to pass scraping challenge");
      }

      log.info("Passed Instagram challenge");

      return this.fetchWithBypass(url, authenticated, attemptsLeft - 1);
    } else {
      return res;
    }
  }

  /**
   * Attempts to pass scraping challenge
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
    const pathSegments = getUrlSegments(url);

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
) {
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
