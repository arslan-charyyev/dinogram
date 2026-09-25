import { retry } from "@std/async";
import { z } from "zod";
import { messages } from "../core/messages.ts";
import {
  AudioFile,
  FileBuilder,
  MediaFile,
  SingleMediaFile,
} from "../model/file.ts";
import { FilePost, PostBuilder } from "../model/post.ts";
import { getUrlSegments } from "../utils/utils.ts";
import { ExternalMediaError, PlatformClient } from "./platform-client.ts";

const PINTEREST_HOST = /(^|\.)pinterest\.[a-z.]+$/;

/**
 * Matches /pin/123/, the slug form /pin/some-title--123/, and the share form
 * /pin/123/sent/?invite_code=…
 */
const PIN_PATH = /\/pin\/(?:[^/]*--)?(\d+)/;

/**
 * The MP4 variants of a video, the best first. Pinterest also lists HLS
 * playlists, which Telegram cannot send.
 */
const MP4_KEYS = ["V_720P", "V_EXP7", "V_EXP6", "V_EXP5", "V_EXP4", "V_EXP3"];

const Media = z.object({ url: z.string() }).nullish();
const Images = z.record(z.string(), Media);
const Videos = z.object({ video_list: z.record(z.string(), Media).nullish() });

const Block = z.object({
  video: Videos.nullish(),
  image: z.object({ images: Images.nullish() }).nullish(),
  audio: z.object({
    audio_url: z.string().nullish(),
    title: z.string().nullish(),
    artist_name: z.string().nullish(),
  }).nullish(),
});

const Pin = z.object({
  title: z.string().nullish(),
  grid_title: z.string().nullish(),
  description: z.string().nullish(),
  closeup_unified_description: z.string().nullish(),
  embed: z.object({
    type: z.string().nullish(),
    src: z.string().nullish(),
  }).nullish(),
  images: Images.nullish(),
  videos: Videos.nullish(),
  carousel_data: z.object({
    carousel_slots: z.array(z.object({
      images: Images.nullish(),
      videos: Videos.nullish(),
    })),
  }).nullish(),
  story_pin_data: z.object({
    metadata: z.object({ pin_title: z.string().nullish() }).nullish(),
    pages: z.array(z.object({ blocks: z.array(Block) })),
  }).nullish(),
});

type Pin = z.infer<typeof Pin>;
type VideoList = z.infer<typeof Videos>["video_list"];

const PinResponse = z.object({
  resource_response: z.object({ data: Pin }),
});

/**
 * Downloads public pins without a login, through the JSON endpoint that the
 * Pinterest website uses. Boards and profiles are not supported, because a
 * board can hold hundreds of pins.
 */
export class PinterestClient extends PlatformClient {
  override name = "Pinterest";

  private pageHtml?: Promise<string>;

  static override supportsLink(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    const hasPath = getUrlSegments(url).length > 0;

    return hasPath && (host === "pin.it" || PINTEREST_HOST.test(host));
  }

  override async fetchPost(): Promise<FilePost> {
    const id = await this.resolvePinId();
    const pin = await this.fetchPin(id);

    return await this.buildPost(id, pin);
  }

  /**
   * A shared pin is almost always a pin.it short link, which redirects
   * through api.pinterest.com. The location of that redirect names the pin.
   */
  private async resolvePinId(): Promise<string> {
    let url = this.pageUrl;

    if (url.hostname.toLowerCase() === "pin.it") {
      const [code] = getUrlSegments(url);
      const response = await retry(() =>
        this.fetch(
          `https://api.pinterest.com/url_shortener/${
            encodeURIComponent(code)
          }/redirect/`,
          { redirect: "manual" },
        )
      );
      await response.body?.cancel();

      const location = response.headers.get("location");
      if (!location) {
        throw Error("The short link did not redirect", {
          cause: { url: url.toString(), status: response.status },
        });
      }

      url = new URL(location, "https://www.pinterest.com");
    }

    const id = url.pathname.match(PIN_PATH)?.[1];
    if (!id) throw Error(messages.PINTEREST_NOT_A_PIN);

    return id;
  }

  private async fetchPin(id: string): Promise<Pin> {
    const data = JSON.stringify({
      options: { id, field_set_key: "unauth_react_main_pin" },
    });
    const url = "https://www.pinterest.com/resource/PinResource/get/?data=" +
      encodeURIComponent(data);

    const response = await retry(() =>
      this.fetch(url, {
        // Without this header the endpoint answers 403
        headers: { "X-Pinterest-PWS-Handler": "www/pin/[id].js" },
      })
    );

    // Pinterest answers the same for a deleted pin and for a pin that only
    // signed-in users may see
    if (response.status === 404) {
      await response.body?.cancel();
      throw Error(messages.PINTEREST_NOT_FOUND);
    }

    if (!response.ok) {
      throw Error("Pinterest API not OK", {
        cause: {
          status: response.status,
          statusText: response.statusText,
          body: await response.text(),
        },
      });
    }

    return PinResponse.parse(await response.json()).resource_response.data;
  }

  private async buildPost(id: string, pin: Pin): Promise<FilePost> {
    const pageUrl = this.pageUrl;
    const title = clean(pin.title) || clean(pin.grid_title) ||
      clean(pin.story_pin_data?.metadata?.pin_title);
    // Pinterest often sends a single space as the description
    const description = clean(pin.description) ||
      clean(pin.closeup_unified_description);
    const text = title === description || !description
      ? title
      : title
      ? `${title}\n\n${description}`
      : description;

    // A pin of a video from YouTube or Vimeo holds no media of its own. A GIF
    // pin also has an embed, but its GIF lives on Pinterest.
    if (pin.embed?.src && pin.embed.type !== "gif") {
      throw new ExternalMediaError(externalUrl(pin.embed.src));
    }

    const slots = pin.carousel_data?.carousel_slots ?? [];
    if (slots.length > 0) {
      const files = await Promise.all(
        slots.map((slot) =>
          slot.videos?.video_list
            ? this.videoOf(id, slot.videos.video_list)
            : this.imageOf(slot.images)
        ),
      );

      return files.length === 1
        ? PostBuilder.single({ pageUrl, description: text, file: files[0] })
        : PostBuilder.multi({ pageUrl, title, description, files });
    }

    const story = pin.story_pin_data;
    if (story) {
      const blocks = story.pages.flatMap((page) => page.blocks);
      const mediaBlocks = blocks.filter((it) => it.video || it.image);

      // One image keeps the image of the pin itself, because a GIF stays a
      // GIF there, and becomes a still image in the story block
      const isOneImage = mediaBlocks.length === 1 && !mediaBlocks[0].video;

      if (!isOneImage && mediaBlocks.length > 0) {
        const files: MediaFile[] = [];
        for (const block of mediaBlocks) {
          files.push(
            block.video?.video_list
              ? await this.videoOf(id, block.video.video_list)
              : await this.imageOf(block.image?.images),
          );
        }

        // Music plays under a slideshow of images. A video has its own sound.
        const music = blocks.find((it) => it.audio?.audio_url)?.audio;
        const audio: AudioFile | undefined =
          music?.audio_url && files.every((it) => it.type === "photo")
            ? FileBuilder.audio({
              downloadUrl: music.audio_url,
              author: clean(music.artist_name),
              title: clean(music.title),
            })
            : undefined;

        return files.length === 1 && !audio
          ? PostBuilder.single({ pageUrl, description: text, file: files[0] })
          : PostBuilder.multi({ pageUrl, title, description, files, audio });
      }
    }

    if (pin.videos?.video_list) {
      const file = await this.videoOf(id, pin.videos.video_list);
      return PostBuilder.single({ pageUrl, description: text, file });
    }

    const original = pin.images?.orig?.url;
    if (original) {
      const file: SingleMediaFile = /\.gif$/i.test(original)
        ? FileBuilder.animation({ downloadUrl: original })
        : await this.imageOf(pin.images);
      return PostBuilder.single({ pageUrl, description: text, file });
    }

    throw Error("The pin holds no media", { cause: { id } });
  }

  /**
   * Many newer video pins list only an HLS playlist in the JSON. The web page
   * of the pin still links the MP4 file of the same video, which carries the
   * same hash in its name.
   */
  private async videoOf(id: string, list: VideoList): Promise<MediaFile> {
    const urls = Object.values(list ?? {}).map((it) => it?.url ?? "");

    const mp4 = MP4_KEYS.map((key) => list?.[key]?.url)
      .find((it) => it?.endsWith(".mp4")) ??
      urls.find((it) => it.endsWith(".mp4"));
    if (mp4) return FileBuilder.video({ downloadUrl: mp4 });

    const hash = urls
      .map((it) => it.match(/([0-9a-f]{32})\.m3u8/)?.[1])
      .find(Boolean);
    if (!hash) throw Error(messages.PINTEREST_NO_VIDEO_FILE, { cause: { id } });

    const html = await this.fetchPageHtml(id);
    const fromPage = [...html.matchAll(MP4_IN_PAGE)]
      .map((it) => it[1])
      .find((it) => it.includes(hash));
    if (!fromPage) {
      throw Error(messages.PINTEREST_NO_VIDEO_FILE, { cause: { id, hash } });
    }

    return FileBuilder.video({ downloadUrl: fromPage });
  }

  /**
   * The page is about 1.2 MB of HTML, so the video search reads it with a
   * regular expression instead of a DOM, and fetches it once per post
   */
  private fetchPageHtml(id: string): Promise<string> {
    this.pageHtml ??= retry(async () => {
      const response = await this.fetch(`https://www.pinterest.com/pin/${id}/`);
      if (!response.ok) {
        throw Error("Pin page not OK", { cause: { status: response.status } });
      }
      return await response.text();
    });

    return this.pageHtml;
  }

  /**
   * The JSON can name the original image with the wrong extension: it says
   * .jpg, and Pinterest refuses that name, while the same name with .png
   * works. A carousel even lists its images up to 736 px wide only. So each
   * extension of the original is tried. An original above the 10 MB photo
   * limit of Telegram gives way to the 1200 px copy, which Telegram would
   * show at almost the same size anyway, and the 736 px copy comes last.
   */
  private async imageOf(
    images: z.infer<typeof Images> | null | undefined,
  ): Promise<MediaFile> {
    const named = images?.originals?.url ?? images?.orig?.url;
    const preview = images?.["736x"]?.url;
    const base = (named ?? preview?.replace("/736x/", "/originals/"))
      ?.replace(/\.\w+$/, "");

    const candidates = [
      named,
      ...["jpg", "png", "webp"].map((it) => base && `${base}.${it}`),
      base && `${base.replace("/originals/", "/1200x/")}.jpg`,
    ].filter((it, index, all): it is string =>
      !!it && all.indexOf(it) === index
    );

    for (const url of candidates) {
      try {
        const response = await this.fetch(url, { method: "HEAD" });
        const size = Number(response.headers.get("content-length") ?? 0);
        if (response.ok && size <= TELEGRAM_PHOTO_LIMIT) {
          return FileBuilder.photo({ downloadUrl: url });
        }
      } catch (_e) {
        // The next candidate, or the preview, still works
      }
    }

    if (!preview) throw Error("The pin image has no URL");
    return FileBuilder.photo({ downloadUrl: preview });
  }
}

const TELEGRAM_PHOTO_LIMIT = 10 * 1024 * 1024;

const MP4_IN_PAGE = /"(https:\/\/v1\.pinimg\.com\/videos\/[^"]+?\.mp4)"/g;

/**
 * The embed of a Vimeo pin is the player, whose page is not meant for people
 */
function externalUrl(src: string): URL {
  const url = new URL(src.replace(/^http:/, "https:"));
  const vimeoId = url.hostname === "player.vimeo.com"
    ? url.pathname.match(/^\/video\/(\d+)/)?.[1]
    : undefined;

  return vimeoId ? new URL(`https://vimeo.com/${vimeoId}`) : url;
}

function clean(text: string | null | undefined): string {
  return text?.trim() ?? "";
}
