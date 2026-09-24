import { z } from "zod";
import type { YouTubeOption } from "../model/youtube.ts";

/**
 * Telegram plays H.264 video with AAC audio in MP4 on every client. YouTube
 * offers H.264 up to 1080p; the larger sizes exist only as VP9 or AV1, which
 * some clients show as a black screen.
 */
const MAX_SHORT_SIDE = 1080;

/**
 * The menu shows this many video sizes, the largest first
 */
const MAX_VIDEO_OPTIONS = 4;

const Format = z.object({
  format_id: z.string(),
  ext: z.string().nullish(),
  protocol: z.string().nullish(),
  vcodec: z.string().nullish(),
  acodec: z.string().nullish(),
  width: z.number().nullish(),
  height: z.number().nullish(),
  fps: z.number().nullish(),
  tbr: z.number().nullish(),
  abr: z.number().nullish(),
  filesize: z.number().nullish(),
  filesize_approx: z.number().nullish(),
  format_note: z.string().nullish(),
  language: z.string().nullish(),
  language_preference: z.number().nullish(),
  // yt-dlp sets true, false, or "maybe"
  has_drm: z.unknown().optional(),
});

type Format = z.infer<typeof Format>;

export const VideoInfo = z.object({
  id: z.string(),
  title: z.string(),
  channel: z.string().nullish(),
  uploader: z.string().nullish(),
  duration: z.number().nullish(),
  live_status: z.string().nullish(),
  media_type: z.string().nullish(),
  formats: z.array(Format).nullish(),
});

export type VideoInfo = z.infer<typeof VideoInfo>;

export type OptionLimits = {
  readonly maxBytes: number;
  readonly maxVideoSeconds: number;
  readonly maxAudioSeconds: number;
};

export function selectOptions(info: VideoInfo, limits: OptionLimits): {
  videoOptions: YouTubeOption[];
  audioOptions: YouTubeOption[];
} {
  // HLS formats have no size and need ffmpeg to fetch, so only direct files
  const formats = (info.formats ?? []).filter((it) =>
    it.protocol === "https" && !it.has_drm
  );

  const audioTrack = selectAudioTrack(formats);
  const bestAudio = audioTrack[0];

  const audioOptions = distinctBy(
    audioTrack.map<YouTubeOption>((it) => ({
      kind: "audio",
      formatId: it.format_id,
      label: `${Math.round(it.abr ?? it.tbr ?? 0)} kbps`,
      size: sizeOf(it),
    })),
    (it) => it.label,
  );

  const duration = info.duration ?? 0;
  const fits = (it: YouTubeOption) => it.size <= limits.maxBytes;

  // The size limit applies before the cut to the largest sizes, so that a
  // long video still offers the small sizes that fit
  let videoOptions = bestAudio
    ? selectVideoFormats(formats).map<YouTubeOption>((it) => ({
      kind: "video",
      formatId: `${it.format_id}+${bestAudio.format_id}`,
      label: labelOf(it),
      size: sumOfSizes(sizeOf(it), sizeOf(bestAudio)),
      width: it.width ?? undefined,
      height: it.height ?? undefined,
    })).filter(fits).slice(0, MAX_VIDEO_OPTIONS)
    : [];

  if (videoOptions.length === 0) {
    // Some videos, such as age-restricted ones, offer only the old 360p file
    // that holds both video and audio
    const progressive = formats.find((it) =>
      it.format_id === "18" && it.ext === "mp4"
    );
    if (progressive) {
      const option: YouTubeOption = {
        kind: "video",
        formatId: progressive.format_id,
        label: labelOf(progressive),
        size: sizeOf(progressive),
        width: progressive.width ?? undefined,
        height: progressive.height ?? undefined,
      };
      videoOptions = [option].filter(fits);
    }
  }

  return {
    videoOptions: duration <= limits.maxVideoSeconds ? videoOptions : [],
    audioOptions: duration <= limits.maxAudioSeconds
      ? audioOptions.filter(fits)
      : [],
  };
}

/**
 * Picks the AAC formats of one audio track, the best bitrate first. A dubbed
 * video has a track for each language; YouTube marks the original one with
 * the highest language preference. A "DRC" format has a compressed dynamic
 * range, so a plain format wins over it.
 */
function selectAudioTrack(formats: Format[]): Format[] {
  const candidates = formats
    .filter((it) =>
      isNone(it.vcodec) && it.acodec?.startsWith("mp4a") && it.ext === "m4a"
    )
    .sort((a, b) =>
      (b.language_preference ?? -1) - (a.language_preference ?? -1) ||
      Number(isDrc(a)) - Number(isDrc(b)) ||
      (b.abr ?? 0) - (a.abr ?? 0)
    );

  const best = candidates[0];
  if (!best) return [];

  return candidates.filter((it) =>
    it.language === best.language && isDrc(it) === isDrc(best)
  );
}

/**
 * YouTube can refuse the formats and still list the storyboards, which are
 * images. Such a probe has failed, even though yt-dlp returns no error.
 */
export function hasMediaFormats(info: VideoInfo): boolean {
  return (info.formats ?? []).some((it) =>
    it.protocol === "https" && (!isNone(it.vcodec) || !isNone(it.acodec))
  );
}

/**
 * Picks one H.264 format per size label, the largest first
 */
function selectVideoFormats(formats: Format[]): Format[] {
  const candidates = formats
    .filter((it) =>
      isNone(it.acodec) &&
      it.vcodec?.startsWith("avc1") &&
      it.ext === "mp4" &&
      it.width && it.height &&
      Math.min(it.width, it.height) <= MAX_SHORT_SIDE
    )
    .sort((a, b) =>
      shortSide(b) - shortSide(a) ||
      (b.fps ?? 0) - (a.fps ?? 0) ||
      (b.tbr ?? 0) - (a.tbr ?? 0)
    );

  return distinctBy(candidates, labelOf);
}

/**
 * YouTube's own label, such as "1080p" or "720p60", matches what the user
 * sees in the YouTube player
 */
function labelOf(format: Format): string {
  const note = format.format_note?.match(/^\d+p\d*/)?.[0];
  return note ?? `${shortSide(format)}p`;
}

function shortSide(format: Format): number {
  return Math.min(format.width ?? 0, format.height ?? 0);
}

function sizeOf(format: Format): number {
  return format.filesize ?? format.filesize_approx ?? 0;
}

/**
 * A size of 0 means "unknown", so an unknown part makes the sum unknown too
 */
function sumOfSizes(a: number, b: number): number {
  return a > 0 && b > 0 ? a + b : 0;
}

function isNone(codec: string | null | undefined): boolean {
  return !codec || codec === "none";
}

function isDrc(format: Format): boolean {
  return /drc/i.test(format.format_id) ||
    /\bDRC\b/.test(format.format_note ?? "");
}

function distinctBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    const value = key(it);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}
