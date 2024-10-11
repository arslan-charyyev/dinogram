import { retry } from "@std/async";
import { wrapFetch } from "another-cookiejar";
import z from "zod";
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
  private static PHOTO_DOC_ID = "8845758582119845";

  name = "Instagram";

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

  override async fetchPost(): Promise<FilePost> {
    const pathSegments = getUrlSegments(this.pageUrl);
    const shortcode = pathSegments.at(1);
    if (!shortcode) throw new Error("No shortcode found in URL");

    if (pathSegments.at(0) === "reel") {
      return await this.fetchSingleFilePost(shortcode);
    } else if (pathSegments.at(0) === "p") {
      return await this.fetchMultiFilePost(shortcode);
    }

    throw new Error("Invalid link");
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
      throw new Error("Invalid link (no shortcode media)");
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
    const post = await this.fetchParsedQuery( // TODO: Rename photo to post
      PhotoSchema,
      InstagramClient.PHOTO_DOC_ID,
      shortcode,
    );

    if (!post.data.xdt_shortcode_media) {
      throw new Error("Invalid link (no shortcode media)");
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
      ["reel", "p"].includes(pathSegments.at(0) ?? "");
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

const PhotoSchema = z.object({
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
