import { retry } from "@std/async";
import { CookieJar, wrapFetch } from "another-cookiejar";
import { DOMParser } from "@b-fuze/deno-dom";
import { z } from "zod";
import { messages } from "../core/messages.ts";
import { AudioFile, FileBuilder, MediaFile } from "../model/file.ts";
import { FilePost, MultiFilePost, PostBuilder } from "../model/post.ts";
import { getUrlSegments, randInt, randStr } from "../utils/utils.ts";
import { PlatformClient } from "./platform-client.ts";

// The image CDN of TikTok breaks an HTTP/2 connection that carries a second
// batch of ten parallel downloads, and the bodies fail halfway through.
// HTTP/1.1 gives each download its own connection.
const http1Client = Deno.createHttpClient({ http2: false });

export class TikTokClient extends PlatformClient {
  override name = "TikTok";
  userAgent: string;
  readonly cookieJar = new CookieJar();

  constructor(pageUrl: URL) {
    super(pageUrl);

    const str1 = randStr(4, 10);
    const str2 = randStr(3, 7);
    const version = randInt(10, 300);
    const timestamp = Math.round(Date.now() / 1000);

    this.userAgent = `${str1}-${str2}/${version} (${timestamp}.0)`;

    this.fetch = wrapFetch({
      cookieJar: this.cookieJar,
      fetch: (input, init) => {
        const headers = new Headers({
          "referer": "https://www.tiktok.com/",
          "user-agent": this.userAgent,
        });

        // The headers we get will contain cookie headers
        if (init?.headers instanceof Headers) {
          init?.headers.forEach((val, key) => {
            headers.append(key, val);
          });
        }

        return globalThis.fetch(input, {
          ...init,
          headers,
          client: http1Client,
        });
      },
    });
  }

  override async fetchPost(): Promise<FilePost> {
    const scope = await this.fetchScope(this.pageUrl);
    const videoDetail = scope["webapp.video-detail"];
    if (videoDetail) {
      return this.parseItem(videoDetail);
    }

    // TikTok leaves a photo post out of its photo page, but the video page of
    // the same ID carries the whole post, images and music included.
    const canonicalUrl = new URL(scope["seo.abtest"].canonical);
    const canonicalSegments = getUrlSegments(canonicalUrl);
    const itemId = canonicalSegments.at(-1);
    if (canonicalSegments.at(-2) === "photo" && itemId) {
      const author = canonicalSegments.slice(0, -2).join("/");
      const videoPageUrl = new URL(
        `/${author}/video/${itemId}`,
        canonicalUrl,
      );
      const photoDetail = (await this.fetchScope(videoPageUrl))[
        "webapp.video-detail"
      ];
      if (!photoDetail) {
        throw new Error(messages.POSSIBLY_SIGN_IN_REQUIRED);
      }
      return this.parseItem(photoDetail);
    }

    throw new Error("Invalid TikTok link");
  }

  private async fetchScope(pageUrl: URL): Promise<DefaultScope> {
    const scriptElement = await retry(async () => {
      const response = await this.fetch(pageUrl);
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const scriptSelector = 'script[id="__UNIVERSAL_DATA_FOR_REHYDRATION__"]';
      const element = doc.querySelector(scriptSelector);

      if (!element) {
        throw Error("Rehydration data not found");
      }

      for (const cookie of response.headers.getSetCookie()) {
        this.cookieJar.setCookie(cookie);
      }

      return element;
    });

    const scriptJson = JSON.parse(scriptElement.innerHTML);
    return ScriptSchema.parse(scriptJson).__DEFAULT_SCOPE__;
  }

  private parseItem(videoDetail: VideoDetail): FilePost {
    // TikTok sends the detail without the item when the post is private or
    // needs a sign-in
    if (!videoDetail.itemInfo) {
      throw new Error(messages.POSSIBLY_SIGN_IN_REQUIRED, {
        cause: videoDetail,
      });
    }

    const { itemStruct } = videoDetail.itemInfo;
    if (itemStruct.imagePost) {
      return this.parsePhotoPost(itemStruct, itemStruct.imagePost);
    }

    const { video, desc } = itemStruct;

    const description = desc.trim();
    const downloadUrl = video.playAddr ?? video.downloadAddr;

    if (!downloadUrl) {
      throw new Error(messages.POSSIBLY_SIGN_IN_REQUIRED);
    }

    return PostBuilder.single({
      description,
      pageUrl: this.pageUrl,
      file: FileBuilder.video({ downloadUrl }),
    });
  }

  private parsePhotoPost(
    itemStruct: ItemStruct,
    imagePost: ImagePost,
  ): MultiFilePost {
    const description = itemStruct.desc.trim();
    const title = imagePost.title.trim();
    const files: MediaFile[] = imagePost.images.map((it) =>
      FileBuilder.photo({ downloadUrl: it.imageURL.urlList[0] })
    );

    const { music } = itemStruct;
    const audio: AudioFile | undefined = music?.playUrl
      ? FileBuilder.audio({
        downloadUrl: music.playUrl,
        title: music.title,
        author: music.authorName,
      })
      : undefined;

    return PostBuilder.multi({
      title,
      description,
      files,
      audio,
      pageUrl: this.pageUrl,
    });
  }

  static override supportsLink(url: URL): boolean {
    return url.hostname.endsWith("tiktok.com");
  }
}

const ScriptSchema = z.object({
  __DEFAULT_SCOPE__: z.object({
    "seo.abtest": z.object({
      canonical: z.string(),
    }),
    "webapp.video-detail": z.object({
      statusCode: z.number().int(),
      statusMsg: z.string().optional(),
      itemInfo: z.object({
        itemStruct: z.object({
          desc: z.string(),
          video: z.object({
            height: z.number().int(),
            width: z.number().int(),
            playAddr: z.string().describe("without watermark").optional(),
            downloadAddr: z.string().describe("with watermark").optional(),
          }),
          imagePost: z.object({
            title: z.string(),
            images: z.array(z.object({
              imageHeight: z.number().int(),
              imageWidth: z.number().int(),
              imageURL: z.object({
                urlList: z.array(z.string()),
              }),
            })),
          }).optional(),
          music: z.object({
            authorName: z.string(),
            playUrl: z.string().optional(),
            title: z.string(),
          }).optional(),
        }),
      }).optional(),
    }).optional(),
  }),
});

type DefaultScope = z.TypeOf<typeof ScriptSchema>["__DEFAULT_SCOPE__"];

type VideoDetail = NonNullable<DefaultScope["webapp.video-detail"]>;

type ItemStruct = NonNullable<VideoDetail["itemInfo"]>["itemStruct"];

type ImagePost = NonNullable<ItemStruct["imagePost"]>;
