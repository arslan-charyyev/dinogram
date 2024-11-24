import { retry } from "@std/async";
import { DOMParser } from "deno-dom";
import z from "zod";
import { db } from "../core/db.ts";
import { messages } from "../core/messages.ts";
import { FileBuilder } from "../model/file.ts";
import {
  FilePost,
  MultiFilePost,
  PostBuilder,
  SingleFilePost,
} from "../model/post.ts";
import { AppCookieJar } from "../utils/app-cookie-jar.ts";
import { getUrlSegments } from "../utils/utils.ts";
import { PlatformClient } from "./platform-client.ts";

export class InstagramClient extends PlatformClient {
  // TODO: How to extract Doc IDs dynamically?
  private static REEL_DOC_ID = "23866501239623009";
  private static POST_DOC_ID = "8845758582119845";
  private static IG_APP_ID = "936619743392459";

  override name = "Instagram";

  constructor(pageUrl: URL) {
    super(pageUrl);

    this.fetch = async (input, init) => {
      const headers: HeadersInit = {
        "user-agent": "Chrome",
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

  /**
   * It would appear that there two ways to fetch data,
   * depending on authentication status of the client.
   */
  override async fetchPost(): Promise<FilePost> {
    const cookie = await db.instagram.cookie.get();

    if (cookie) {
      return this.fetchPostAuthenticated();
    } else {
      return this.fetchPostAnonymously();
    }
  }

  private async fetchPostAuthenticated(): Promise<FilePost> {
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

  private async fetchMediaInfo(): Promise<z.infer<typeof MediaInfoSchema>> {
    // Step 1. Get post html
    const html = await retry(async () => {
      const res = await this.fetch(this.pageUrl);

      return res.text();
    });

    // Step 2. Find media info URL
    const doc = new DOMParser().parseFromString(html, "text/html");

    // Example:
    // <meta property="al:ios:url" content="instagram://media?id=3445445944417076601" />
    const metaElement = doc.querySelector('head > meta[property="al:ios:url"]');
    if (!metaElement) throw new Error("Meta property al:ios:url not found");

    const metaContent = metaElement.getAttribute("content");
    if (!metaContent) throw new Error("Meta content not found");

    const metaUrl = new URL(metaContent);
    const mediaId = metaUrl.searchParams.get("id");
    if (!mediaId) throw new Error(`Media ID not found in Meta URL ${metaUrl}`);

    const mediaInfoUrl =
      `https://www.instagram.com/api/v1/media/${mediaId}/info/`;

    // Step 3. Fetch media info
    const mediaInfoJson = await retry(async () => {
      const res = await this.fetch(mediaInfoUrl);
      return res.json();
    });

    const mediaInfo = MediaInfoSchema.safeParse(mediaInfoJson);

    if (!mediaInfo.success) {
      throw new Error("Failed to fetch media info");
    }

    return mediaInfo.data;
  }

  private async fetchPostAnonymously(): Promise<FilePost> {
    const pathSegments = getUrlSegments(this.pageUrl);
    const shortcode = pathSegments.at(1);
    if (!shortcode) throw new Error("No shortcode found in URL");

    if (pathSegments.at(0) === "reel") {
      return await this.fetchSingleFilePost(shortcode);
    } else if (pathSegments.at(0) === "p") {
      return await this.fetchMultiFilePost(shortcode);
    }

    throw new Error(messages.INVALID_LINK);
  }

  private async fetchSingleFilePost(
    shortcode: string,
  ): Promise<SingleFilePost> {
    const reel = await this.fetchParsedQuery(
      ReelSchema,
      InstagramClient.REEL_DOC_ID,
      shortcode,
    );

    if (!reel.data.xdt_shortcode_media) {
      throw new Error(messages.POSSIBLY_SIGN_IN_REQUIRED);
    }

    const { edge_media_to_caption, video_url } = reel.data.xdt_shortcode_media;

    return PostBuilder.single({
      description: edge_media_to_caption.edges.at(0)?.node.text ?? "",
      pageUrl: this.pageUrl,
      file: FileBuilder.video({
        downloadUrl: video_url,
      }),
    });
  }

  private async fetchMultiFilePost(shortcode: string): Promise<MultiFilePost> {
    const post = await this.fetchParsedQuery(
      PostSchema,
      InstagramClient.POST_DOC_ID,
      shortcode,
    );

    if (!post.data.xdt_shortcode_media) {
      throw new Error(messages.POSSIBLY_SIGN_IN_REQUIRED);
    }

    const { edge_media_to_caption, edge_sidecar_to_children } =
      post.data.xdt_shortcode_media;

    const files = edge_sidecar_to_children.edges.map(({ node }) =>
      node.is_video
        ? FileBuilder.video({ downloadUrl: node.video_url })
        : FileBuilder.photo({ downloadUrl: node.display_url })
    );

    const description = edge_media_to_caption.edges.at(0)?.node.text ?? "";

    return PostBuilder.multi({
      description,
      pageUrl: this.pageUrl,
      files,
    });
  }

  private fetchParsedQuery<Output>(
    schema: z.Schema<Output>,
    docId: string,
    shortCode: string,
  ): Promise<Output> {
    return retry(async () => {
      const response = await fetch(
        "https://www.instagram.com/graphql/query",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            variables: JSON.stringify({ shortcode: shortCode }),
            doc_id: docId,
          }),
        },
      );

      if (!response.ok) throw Error(response.statusText);

      const json = await response.json();

      return schema.parse(json);
    });
  }

  static override supportsLink(url: URL): boolean {
    const pathSegments = getUrlSegments(url);

    return url.hostname.endsWith("instagram.com") &&
      (pathSegments.includes("reel") || pathSegments.includes("p"));
  }
}

const ReelSchema = z.object({
  status: z.string(),
  data: z.object({
    xdt_shortcode_media: z.object({
      is_video: z.literal(true),
      video_url: z.string(),
      edge_media_to_caption: z.object({
        edges: z.array(z.object({
          node: z.object({
            text: z.string(),
          }),
        })),
      }),
    }).nullable(),
  }),
});

const PostSchema = z.object({
  status: z.string(),
  data: z.object({
    xdt_shortcode_media: z.object({
      is_video: z.literal(false),
      edge_sidecar_to_children: z.object({
        edges: z.array(z.object({
          node: z.discriminatedUnion("is_video", [
            z.object({
              is_video: z.literal(false),
              display_url: z.string().url(),
            }),
            z.object({
              is_video: z.literal(true),
              video_url: z.string().url(),
            }),
          ]),
        })),
      }),
      edge_media_to_caption: z.object({
        edges: z.array(z.object({
          node: z.object({
            text: z.string(),
          }),
        })),
      }),
    }).nullable(),
  }),
});

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
    z.discriminatedUnion("media_type", [
      ImageMediaSchema,
      VideoMediaSchema,
    ]),
  ),
});

const MediaInfoSchema = z.object({
  status: z.literal("ok"),
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
  const originalCandidate = candidates.find((candidate) =>
    candidate.height === media.original_height &&
    candidate.width === media.original_width
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
      const bestCandidate = findBestCandidate(
        media,
        media.video_versions,
      );

      return FileBuilder.video({ downloadUrl: bestCandidate.url });
    }
  }
}
