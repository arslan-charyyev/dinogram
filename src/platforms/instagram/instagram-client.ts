import { DOMParser, HTMLDocument } from "@b-fuze/deno-dom";
import { retry } from "@std/async/retry";
import { JSONPath } from "jsonpath-plus";
import { randomInt } from "node:crypto";
import z from "zod";
import { log } from "../../core/log.ts";
import { getPathSegments, runAfter } from "../../core/utils.ts";
import { VNCBrowser } from "../../core/vnc-browser.ts";
import { AuthMode } from "../../model/auth-mode.ts";
import { FileBuilder, type MediaFile } from "../../model/file.ts";
import { FilePost, PostBuilder } from "../../model/post.ts";
import { instagramDb } from "./instagram-db.ts";
import { cookiesHaveInstagramLoginData } from "./instagram-login.ts";
import { PlatformClient } from "../platform-client.ts";

export class InstagramClient extends PlatformClient {
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

      const res = await fetch(input, {
        referrerPolicy: "strict-origin-when-cross-origin",
        ...init,
        headers: {
          ...headers,
          ...init?.headers,
        },
      });

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
    const browser = await VNCBrowser.instance();
    const cookies = await browser.cookies();

    if (!cookiesHaveInstagramLoginData(cookies)) {
      throw new Error(
        "No Instagram login data found. " +
          "Ask bot admin to login via bot settings " +
          "or to switch to anonymous authentication mode.",
      );
    }

    const page = await browser.newPage();
    try {
      log.debug(`Opening page URL: ${this.pageUrl}`);

      const res = await page.goto(this.pageUrl.toString(), { timeout: 0 });
      if (!res) throw new Error(`Failed to open page: ${this.pageUrl}`);

      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");

      // TODO: Check if user is still logged in

      const mediaInfoJson = this.extractMediaInfo(doc);
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
        callback: async () => {
          if (!page.isClosed()) {
            await page.close();
          }
        },
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

    const mediaInfoJson = this.extractMediaInfo(doc);

    const mediaInfo = MediaInfoSchema.safeParse(mediaInfoJson);

    if (!mediaInfo.success) {
      throw new Error("Failed to parse media info", { cause: mediaInfo.error });
    }

    return mediaInfo.data;
  }

  private extractMediaInfo(doc: HTMLDocument): unknown {
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
