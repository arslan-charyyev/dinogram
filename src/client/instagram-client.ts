import { retry } from "@std/async";
import { wrapFetch } from "another-cookiejar";
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

    this.fetch = wrapFetch({
      fetch: (input, init) =>
        fetch(input, {
          headers: {
            "User-Agent": "Chrome",
          },
          ...init,
        }),
    });
  }

  /**
   * It would appear that there two ways to fetch data,
   * depending on authentication status of the client.
   */
  override async fetchPost(): Promise<FilePost> {
    const cookie = await db.instagram.cookie.get();

    if (cookie) {
      return this.fetchPostAuthenticated(cookie);
    } else {
      return this.fetchPostAnonymously();
    }
  }

  private async fetchPostAuthenticated(cookie: string): Promise<FilePost> {
    const mediaInfo = await this.fetchMediaInfo(cookie);
    const mediaItem = mediaInfo.items[0];

    const description = mediaItem.caption?.text ?? "";
    const pageUrl = this.pageUrl;

    switch (mediaItem.media_type) {
      case MediaType.Image: {
        const file = FileBuilder.video({
          downloadUrl: mediaItem.image_versions2.candidates[0].url,
        });

        return PostBuilder.single({ description, pageUrl, file });
      }
      case MediaType.Video: {
        const file = FileBuilder.video({
          downloadUrl: mediaItem.video_versions[0].url,
        });

        return PostBuilder.single({ description, pageUrl, file });
      }
      case MediaType.Carousel: {
        const files = mediaItem.carousel_media.map((it) =>
          it.media_type === MediaType.Video
            ? FileBuilder.video({ downloadUrl: it.video_versions[0].url })
            : FileBuilder.photo({
              downloadUrl: it.image_versions2.candidates[0].url,
            })
        );

        return PostBuilder.multi({ description, pageUrl, files });
      }
    }
  }

  private async fetchMediaInfo(
    cookie: string,
  ): Promise<z.infer<typeof MediaInfoSchema>> {
    const headers: HeadersInit = {
      "Cookie": cookie,
      "x-ig-app-id": InstagramClient.IG_APP_ID,
    };

    // Step 1. Get post html
    const html = await retry(async () => {
      const res = await fetch(
        this.pageUrl,
        {
          method: "GET",
          headers: headers,
        },
      );

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
      const res = await fetch(mediaInfoUrl, { headers });
      return res.json();
    });

    return MediaInfoSchema.parse(mediaInfoJson);
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

const ImageMediaSchema = z.object({
  media_type: z.literal(MediaType.Image),
  caption: MediaCaptionSchema.nullish(),
  image_versions2: z.object({
    candidates: z.array(z.object({
      url: z.string().url(),
    })),
  }),
});

const VideoMediaSchema = z.object({
  media_type: z.literal(MediaType.Video),
  caption: MediaCaptionSchema.nullish(),
  video_versions: z.array(z.object({
    url: z.string().url(),
  })),
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
