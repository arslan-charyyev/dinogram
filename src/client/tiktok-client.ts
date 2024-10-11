import { retry } from "@std/async";
import { CookieJar, wrapFetch } from "another-cookiejar";
import { DOMParser } from "deno-dom";
import { JSDOM, ResourceLoader } from "jsdom";
import { z } from "zod";
import { Assets } from "../core/assets.ts";
import { getUrlSegments, randInt, randStr } from "../utils/utils.ts";
import { PlatformClient } from "./platform-client.ts";
import {
  FilePost,
  MultiFilePost,
  PostBuilder,
  SingleFilePost,
} from "../model/post.ts";
import { AudioFile, FileBuilder, MediaFile } from "../model/file.ts";

export class TikTokClient extends PlatformClient {
  name = "TikTok";
  userAgent: string;

  constructor(pageUrl: URL) {
    super(pageUrl);

    const str1 = randStr(4, 10);
    const str2 = randStr(3, 7);
    const version = randInt(10, 300);
    const timestamp = Math.round(Date.now() / 1000);

    this.userAgent = `${str1}-${str2}/${version} (${timestamp}.0)`;
    const headers = {
      "Referer": "https://www.tiktok.com/",
      "User-Agent": this.userAgent,
    };

    const cookieJar = new CookieJar([{
      name: "tt_webid_v2",
      value: `${randInt(10 ** 18, 10 ** 19)}`,
    }]);

    this.fetch = wrapFetch({
      cookieJar,
      fetch: (input, init) =>
        fetch(input, {
          headers,
          ...init,
        }),
    });
  }

  override async fetchPost(): Promise<FilePost> {
    const scriptElement = await retry(async () => {
      const response = await this.fetch(this.pageUrl);
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const scriptSelector = 'script[id="__UNIVERSAL_DATA_FOR_REHYDRATION__"]';
      const element = doc.querySelector(scriptSelector);

      if (!element) {
        throw Error("Rehydration data not found");
      }

      return element;
    });

    const scriptJson = JSON.parse(scriptElement.innerHTML);
    const script = ScriptSchema.parse(scriptJson);
    const videoDetail = script.__DEFAULT_SCOPE__["webapp.video-detail"];
    if (videoDetail) {
      return this.fetchVideoPost(videoDetail);
    }

    // TODO: Get it from DOM instead?
    const abtest = script.__DEFAULT_SCOPE__["seo.abtest"];
    const canonicalSegments = getUrlSegments(new URL(abtest.canonical));
    if (canonicalSegments.at(-2) === "photo" && canonicalSegments.at(-1)) {
      return this.fetchPhotoPost(canonicalSegments.at(-1)!);
    }

    throw new Error("Invalid TikTok link");
  }

  private fetchVideoPost(videoDetail: VideoDetail): SingleFilePost {
    // We're dealing with a video

    if (!videoDetail.itemInfo) {
      throw new Error("Video detail has no item info", {
        cause: videoDetail,
      });
    }

    const { video, desc } = videoDetail.itemInfo.itemStruct;

    const description = desc.trim();
    const downloadUrl = video.playAddr ?? video.downloadAddr;

    if (!downloadUrl) {
      throw new Error(
        "No download URL found. " +
          "Possible causes: private video or sign-in required.",
      );
    }

    return PostBuilder.single({
      description,
      pageUrl: this.pageUrl,
      file: FileBuilder.video({ downloadUrl }),
    });
  }

  private async fetchPhotoPost(itemId: string): Promise<MultiFilePost> {
    const params = new URLSearchParams({
      "itemId": itemId,
      "aid": "1998",
      "app_language": "en",
      "app_name": "tiktok_web",
      "browser_language": "en-US",
      "browser_name": "Mozilla",
      "browser_platform": "Win32",
      "browser_version": "4.0",
      "device_id": "1234567890123456789",
      "device_platform": "web_pc",
      "os": "windows",
      "region": "US",
      "screen_height": "720",
      "screen_width": "1280",
      "webcast_language": "en",
    }).toString();

    const unsignedUrl = `https://www.tiktok.com/api/item/detail?${params}`;

    const signedUrl = await TikTokClient.signUrl(unsignedUrl, this.userAgent);

    const res = await retry(() =>
      this.fetch(signedUrl, {
        headers: { "User-Agent": this.userAgent },
      })
    );

    const itemDetailJson = await res.json();
    const itemDetail = ItemDetailSchema.parse(itemDetailJson);

    if (!itemDetail.itemInfo) {
      throw new Error("Photo detail has no item info");
    }

    const { itemStruct } = itemDetail.itemInfo;

    const description = itemStruct.desc.trim();
    const title = itemStruct.imagePost.title.trim();
    const downloadUrls = itemStruct.imagePost.images.map(
      (it) => it.imageURL.urlList[0],
    );
    const audioUrl = itemStruct.music.playUrl;
    const audioTitle = itemStruct.music.title;
    const audioAuthor = itemStruct.music.authorName;
    const audio: AudioFile = FileBuilder.audio({
      downloadUrl: audioUrl,
      title: audioTitle,
      author: audioAuthor,
    });

    const files: MediaFile[] = downloadUrls.map((downloadUrl) =>
      FileBuilder.photo({ downloadUrl })
    );

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

  private static async signUrl(unsignedUrl: string, userAgent: string) {
    const signatureJs = await Deno.readTextFile(Assets.js.signature);
    const webmssdkJs = await Deno.readTextFile(Assets.js.webmssdk);

    const { window } = new JSDOM("", {
      url: "https://www.tiktok.com",
      referrer: "https://www.tiktok.com",
      contentType: "text/html",
      includeNodeLocations: false,
      runScripts: "outside-only",
      pretendToBeVisual: true,
      resources: new ResourceLoader({ userAgent }),
    });

    window.eval(signatureJs);

    window.byted_acrawler.init({ aid: 24, dfp: true });

    window.eval(webmssdkJs);

    const url = new URL(unsignedUrl);

    const signature = window.byted_acrawler.sign({ url: url.toString() });
    url.searchParams.append("_signature", signature);

    const bogus = window._0x32d649(url.searchParams.toString());
    url.searchParams.append("X-Bogus", bogus);

    window.close();

    return url.toString();
  }
}

const ScriptSchema = z.object({
  "__DEFAULT_SCOPE__": z.object({
    "seo.abtest": z.object({
      "canonical": z.string(),
    }),
    "webapp.video-detail": z.object({
      "statusCode": z.number().int(),
      "statusMsg": z.string().optional(),
      "itemInfo": z.object({
        "itemStruct": z.object({
          "desc": z.string(),
          "video": z.object({
            "playAddr": z.string().describe("without watermark").optional(),
            "downloadAddr": z.string().describe("with watermark").optional(),
          }),
        }),
      }).optional(),
    }).optional(),
  }),
});

type VideoDetail = NonNullable<
  z.TypeOf<typeof ScriptSchema>["__DEFAULT_SCOPE__"]["webapp.video-detail"]
>;

const ItemDetailSchema = z.object({
  "itemInfo": z.object({
    "itemStruct": z.object({
      "desc": z.string(),
      "imagePost": z.object({
        "title": z.string(),
        "images": z.array(z.object({
          "imageURL": z.object({
            "urlList": z.array(z.string()),
          }),
        })),
      }),
      "music": z.object({
        "authorName": z.string(),
        "playUrl": z.string(),
        "title": z.string(),
      }),
    }),
  }).optional(),
});
