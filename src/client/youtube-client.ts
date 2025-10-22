import { resolve } from "@std/path";
import { PassThrough } from "node:stream";
import tempDir from "temp-dir";
import { QualityOptions, YtDlp } from "ytdlp-nodejs";
import { config } from "../core/config.ts";
import { db } from "../core/db.ts";
import {
  type MultiQualityVideoPost,
  PostBuilder,
  type QualityVariant,
} from "../model/post.ts";
import { getUrlSegments } from "../utils/utils.ts";
import { PlatformClient } from "./platform-client.ts";

export class YouTubeClient extends PlatformClient {
  override name = "YouTube";
  private readonly ytDlp: YtDlp;

  constructor(pageUrl: URL) {
    super(pageUrl);

    this.ytDlp = new YtDlp({ binaryPath: config.YT_DLP_PATH });

    const depsInstalled = this.ytDlp.checkInstallation({ ffmpeg: false });
    if (!depsInstalled) {
      throw new Error("yt-dlp dependencies not installed");
    }
  }

  static override supportsLink(url: URL): boolean {
    const pathSegments = getUrlSegments(url);

    return (
      url.hostname.endsWith("youtube.com") &&
      pathSegments.includes("watch")
    );
  }

  override async fetchPost(): Promise<MultiQualityVideoPost> {
    const info = await this.ytDlp.getInfoAsync(this.pageUrl.toString(), {
      cookies: await this.getCookieFile(),
    });

    if (info._type != "video") {
      throw new Error(`Not a YouTube video link: ${this.pageUrl}`);
    }

    const type = "webm";
    const videoFormats = info.formats.filter((f) =>
      f.ext === type && // WebM format is more efficient
      f.vcodec !== "none" && // Only videos
      f.format_note &&
      f.filesize &&
      (f as unknown as { quality: number }).quality !== 0 // Exclude formats that can't be downloaded
    );

    return PostBuilder.multiQualityVideo({
      pageUrl: this.pageUrl,
      videoId: info.id,
      description: info.title,
      thumbnailUrl: info.thumbnail,
      qualityVariants: videoFormats.map<QualityVariant>((f) => ({
        type: "video",
        name: f.format_note!,
        approxByteCount: f.filesize ?? 0, // TODO: Add audio track as well
      })),
    });
  }

  private async getCookieFile(): Promise<string | undefined> {
    const cookieString = await db.youtube.cookie.get();
    if (!cookieString) {
      return undefined;
    }

    const cookieFilePath = resolve(tempDir, "yt-cookies.txt");
    await Deno.writeTextFile(cookieFilePath, cookieString);

    return cookieFilePath;
  }

  static urlFromId(id: string): URL {
    return new URL(`https://www.youtube.com/watch?v=${id}`);
  }

  async getVideoStream(quality: string): Promise<ReadableStream<Uint8Array>> {
    const filter = "mergevideo";
    const response = this.ytDlp.stream(this.pageUrl.toString(), {
      cookies: await this.getCookieFile(),
      format: {
        type: "webm",
        filter,
        quality: quality as QualityOptions[typeof filter],
      },
    });

    // This is a Node.JS stream
    const passThroughStream = new PassThrough();
    response.pipe(passThroughStream, { end: true });

    // But we need to return a web-standard stream, hence we construct it manually
    return new ReadableStream({
      start(controller) {
        passThroughStream.on("data", (chunk) => {
          controller.enqueue(chunk); // Push data to the web stream
        });
        passThroughStream.on("end", () => {
          controller.close(); // Signal the end of the stream
        });
        passThroughStream.on("error", (err) => {
          controller.error(err); // Signal an error
        });
      },
    });
  }
}
