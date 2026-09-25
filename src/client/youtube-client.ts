import { join } from "@std/path";
import { config, uploadLimitBytes } from "../core/config.ts";
import { db } from "../core/db.ts";
import { Downloads } from "../core/downloads.ts";
import { log } from "../core/log.ts";
import { messages } from "../core/messages.ts";
import type {
  YouTubeAccess,
  YouTubeLink,
  YouTubeOption,
  YouTubeVideo,
} from "../model/youtube.ts";
import { Semaphore } from "../utils/semaphore.ts";
import { getUrlSegments } from "../utils/utils.ts";
import {
  hasMediaFormats,
  type OptionLimits,
  selectOptions,
  VideoInfo,
} from "./youtube-formats.ts";
import { mainWarning, YtDlp, YtDlpError } from "./yt-dlp.ts";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOST = /(^|\.)(youtube|youtube-nocookie)\.com$/;

/**
 * Probes take a few seconds each, and they share one CPU with the downloads
 */
const probes = new Semaphore(1);

/**
 * A download needs little memory after its start, but downloads share the CPU
 * and the bandwidth of the server
 */
const downloads = new Semaphore(2);

/**
 * Every yt-dlp run with the default clients or the cookie starts a Deno
 * process of about 350 MB for the challenge solver, a download too, because
 * it extracts the video again. One such run at a time keeps the container
 * under its 1 GB limit, next to the visionOS runs of about 100 MB each.
 */
const solverRuns = new Semaphore(1);

function withSolverSlot<T>(access: YouTubeAccess, run: () => Promise<T>) {
  return access === "visionos" ? run() : solverRuns.run(run);
}

/**
 * A menu press and an inline query can ask for the same video while its probe
 * still runs. They share that probe instead of starting another one.
 */
const probesInFlight = new Map<string, Promise<YouTubeVideo>>();

/**
 * When the anonymous clients hit a sign-in wall and the cookie works, the
 * next probes start with the cookie for a while, instead of failing twice
 * first
 */
const COOKIE_FIRST_MS = 30 * 60_000;
let cookieFirstUntil = 0;

/**
 * An error that the user can act on, so the bot shows its message as it is
 */
export class YouTubeUserError extends Error {}

export type DownloadedFile = {
  readonly path: string;
  readonly size: number;
  readonly cleanup: () => Promise<void>;
};

export class YouTubeClient {
  static parseLink(url: URL): YouTubeLink | null {
    const host = url.hostname.toLowerCase();
    const [first, second] = getUrlSegments(url);

    if (host === "youtu.be") {
      return videoLink(first, false);
    }

    if (!YOUTUBE_HOST.test(host)) return null;

    switch (first) {
      case "watch": {
        const id = url.searchParams.get("v");
        if (id) return videoLink(id, false);
        return url.searchParams.has("list") ? { type: "playlist" } : null;
      }
      case "shorts":
        return videoLink(second, true);
      case "live":
      case "embed":
      case "v":
      case "e":
        return videoLink(second, false);
      case "playlist":
        return url.searchParams.has("list") ? { type: "playlist" } : null;
      default:
        return null;
    }
  }

  static watchUrl(id: string): string {
    return `https://www.youtube.com/watch?v=${id}`;
  }

  /**
   * "hq" is 480×360, for the menu card. "mq" is 320×180, which meets the
   * thumbnail limits of Telegram (JPEG, at most 320 px, under 200 kB).
   */
  static thumbnailUrl(id: string, size: "hq" | "mq"): string {
    return `https://i.ytimg.com/vi/${id}/${size}default.jpg`;
  }

  /**
   * True when a new download would wait for a free slot
   */
  static get isDownloadQueueFull(): boolean {
    return downloads.isFull;
  }

  static fetchVideo(id: string): Promise<YouTubeVideo> {
    // The ID can come from callback data, which a client can forge
    if (!VIDEO_ID.test(id)) {
      return Promise.reject(new YouTubeUserError(messages.YOUTUBE_OUTDATED));
    }

    let video = probesInFlight.get(id);

    if (!video) {
      video = loadVideo(id).finally(() => probesInFlight.delete(id));
      probesInFlight.set(id, video);
    }

    return video;
  }

  /**
   * Downloads the option into its own job directory. The caller must call
   * cleanup() of the result after the upload.
   *
   * @param onProgress receives the done fraction, or undefined when the size
   * of the option is unknown
   */
  static download(
    video: YouTubeVideo,
    option: YouTubeOption,
    onProgress: (fraction: number | undefined) => void,
  ): Promise<DownloadedFile> {
    return downloads.run(async () => {
      const dir = await Downloads.createJobDir();

      try {
        return await downloadWithFallbacks(video, option, dir, onProgress);
      } catch (e) {
        await Downloads.remove(dir);
        throw e;
      }
    });
  }
}

function videoLink(
  id: string | undefined,
  isShort: boolean,
): YouTubeLink | null {
  if (!id || !VIDEO_ID.test(id)) return null;
  return { type: "video", id, isShort };
}

async function loadVideo(id: string): Promise<YouTubeVideo> {
  const cached = await db.youtube.video.get([id]);
  if (cached) return cached;

  const video = await probes.run(() => probe(id));
  await db.youtube.video.set([id], video);

  return video;
}

async function probe(id: string): Promise<YouTubeVideo> {
  const url = YouTubeClient.watchUrl(id);
  const errors: unknown[] = [];

  for (const access of await accessOrder()) {
    try {
      const { info: json, warnings } = await withSolverSlot(
        access,
        () =>
          withCookie(
            access,
            (cookieFile) => YtDlp.probe(url, access, cookieFile),
          ),
      );
      const info = VideoInfo.parse(json);

      if (
        ["is_live", "is_upcoming", "post_live"].includes(info.live_status ?? "")
      ) {
        throw new YouTubeUserError(messages.YOUTUBE_LIVE);
      }

      // The visionOS client cannot play some videos, such as the ones made
      // for kids, and a sign-in wall also leaves no formats. yt-dlp then
      // returns only the storyboard images, and another access can do better.
      if (!hasMediaFormats(info)) {
        throw new YtDlpError(
          mainWarning(warnings) ?? `The ${access} access returned no formats`,
        );
      }

      if (access === "cookie" && errors.some(isSignInWall)) {
        cookieFirstUntil = Date.now() + COOKIE_FIRST_MS;
      }

      return {
        id: info.id,
        title: info.title,
        channel: info.channel ?? info.uploader ?? "",
        duration: info.duration ?? 0,
        isShort: info.media_type === "short",
        ...selectOptions(info, optionLimits()),
        access,
      };
    } catch (e) {
      if (e instanceof YouTubeUserError) throw e;

      log.warn(`YouTube probe of ${id} with the ${access} access failed: ${e}`);
      errors.push(e);
    }
  }

  throw await failureOf(errors);
}

async function downloadWithFallbacks(
  video: YouTubeVideo,
  option: YouTubeOption,
  dir: string,
  onProgress: (fraction: number | undefined) => void,
): Promise<DownloadedFile> {
  const url = YouTubeClient.watchUrl(video.id);
  // The access of the probe comes first, because it offered these formats
  const order = [...new Set([video.access, ...await accessOrder()])];
  const errors: unknown[] = [];

  for (const access of order) {
    try {
      const path = await withSolverSlot(
        access,
        () =>
          withCookie(access, (cookieFile) =>
            YtDlp.download({
              url,
              formatId: option.formatId,
              kind: option.kind,
              dir,
              access,
              cookieFile,
              maxBytes: uploadLimitBytes,
              onProgress: (bytes) =>
                onProgress(
                  option.size > 0
                    ? Math.min(bytes / option.size, 1)
                    : undefined,
                ),
            }), dir),
      );

      const { size } = await Deno.stat(path);
      if (size > uploadLimitBytes) {
        throw new YouTubeUserError(messages.YOUTUBE_TOO_LARGE);
      }

      return { path, size, cleanup: () => Downloads.remove(dir) };
    } catch (e) {
      if (e instanceof YouTubeUserError) throw e;

      log.warn(
        `YouTube download of ${video.id} with the ${access} access failed: ${e}`,
      );
      errors.push(e);
    }
  }

  throw await failureOf(errors);
}

/**
 * The sign-in wall explains more than the errors that followed it, and an
 * admin can act on it with a cookie
 */
async function failureOf(errors: unknown[]): Promise<unknown> {
  const wall = errors.find(isSignInWall);
  if (!wall) return errors[0];

  const hasCookie = !!await db.youtube.cookie.get();
  return new YouTubeUserError(
    hasCookie ? messages.YOUTUBE_SIGN_IN_COOKIE : messages.YOUTUBE_SIGN_IN,
    { cause: wall },
  );
}

async function accessOrder(): Promise<YouTubeAccess[]> {
  const order: YouTubeAccess[] = ["visionos", "default"];

  // An admin sets the cookie when YouTube blocks the server. The anonymous
  // ways still come first, because YouTube can ban the account of a cookie.
  if (await db.youtube.cookie.get()) {
    if (Date.now() < cookieFirstUntil) {
      order.unshift("cookie");
    } else {
      order.push("cookie");
    }
  }

  return order;
}

/**
 * yt-dlp rewrites the cookie file when it exits, so every run gets its own
 * copy, which is deleted right after the run
 */
async function withCookie<T>(
  access: YouTubeAccess,
  run: (cookieFile?: string) => Promise<T>,
  jobDir?: string,
): Promise<T> {
  if (access !== "cookie") return run();

  const cookie = await db.youtube.cookie.get();
  if (!cookie) throw new YtDlpError("No YouTube cookie is set");

  const dir = jobDir ?? await Downloads.createJobDir();
  const file = join(dir, "cookies.txt");
  await Deno.writeTextFile(file, cookie, { mode: 0o600 });

  try {
    return await run(file);
  } finally {
    if (jobDir) {
      await Deno.remove(file).catch(() => {});
    } else {
      await Downloads.remove(dir);
    }
  }
}

function isSignInWall(error: unknown): boolean {
  return error instanceof YtDlpError && error.needsSignIn;
}

function optionLimits(): OptionLimits {
  return {
    maxBytes: uploadLimitBytes,
    maxVideoSeconds: config.YOUTUBE_MAX_VIDEO_MINUTES * 60,
    maxAudioSeconds: config.YOUTUBE_MAX_AUDIO_MINUTES * 60,
  };
}
