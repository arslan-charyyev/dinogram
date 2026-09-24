import { config } from "../core/config.ts";
import { Downloads } from "../core/downloads.ts";
import { log } from "../core/log.ts";
import type { YouTubeAccess } from "../model/youtube.ts";

const PROBE_TIMEOUT_MS = 90_000;
const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;
/**
 * yt-dlp prints a progress line at least once a second while bytes arrive
 */
const DOWNLOAD_STALL_MS = 90_000;

export class YtDlpError extends Error {
  /**
   * YouTube asks to sign in when it distrusts the IP address, or when the
   * video is age-restricted. A cookie can help in both cases.
   */
  get needsSignIn(): boolean {
    return /sign in|not a bot|login_required|confirm your age/i.test(
      this.message,
    );
  }
}

type DownloadArgs = {
  url: string;
  formatId: string;
  kind: "video" | "audio";
  dir: string;
  access: YouTubeAccess;
  cookieFile?: string;
  maxBytes: number;
  /**
   * The sum of the downloaded bytes of every format in the selector
   */
  onProgress: (downloadedBytes: number) => void;
};

export const YtDlp = {
  async version(): Promise<string> {
    const { lines } = await run(["--version"], { timeoutMs: 30_000 });
    return lines[0];
  },

  /**
   * Returns the info JSON of the video, with every format and its size, and
   * the warnings of yt-dlp. A sign-in wall arrives as a warning when yt-dlp
   * returns the info without formats.
   */
  async probe(
    url: string,
    access: YouTubeAccess,
    cookieFile?: string,
  ): Promise<{ info: unknown; warnings: string }> {
    const { lines, stderr } = await run(
      [
        ...commonArgs(access, cookieFile),
        "--dump-single-json",
        // A live stream or a premiere has no formats yet. The info still
        // arrives, so the bot can explain why it cannot download it.
        "--ignore-no-formats-error",
        "--",
        url,
      ],
      { timeoutMs: PROBE_TIMEOUT_MS },
    );

    const warnings = stderr
      .split("\n")
      .filter((it) => it.startsWith("WARNING:"))
      .join("\n");

    return { info: JSON.parse(lines.join("\n")), warnings };
  },

  /**
   * Downloads the formats of the selector into the directory, merges a video
   * and an audio format into one MP4, and returns the path of the result.
   */
  async download(args: DownloadArgs): Promise<string> {
    const downloaded = new Map<string, number>();
    const finished = new Set<string>();
    const formatCount = args.formatId.split("+").length;
    let path: string | undefined;

    await run(
      [
        ...commonArgs(args.access, args.cookieFile),
        "--format",
        args.formatId,
        ...(args.kind === "video" ? ["--merge-output-format", "mp4"] : []),
        "--max-filesize",
        `${args.maxBytes}`,
        "--output",
        `${args.dir}/%(id)s.%(ext)s`,
        "--newline",
        // --print implies --quiet, which would hide the progress lines
        "--progress",
        "--progress-delta",
        "1",
        "--no-warnings",
        "--progress-template",
        "download:progress %(info.format_id)s %(progress.downloaded_bytes)s %(progress.status)s",
        "--print",
        "after_move:filepath",
        "--",
        args.url,
      ],
      {
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
        stallMs: DOWNLOAD_STALL_MS,
        onLine: (line, control) => {
          const match = line.match(/^progress (\S+) (\d+) (\S+)/);
          if (match) {
            const [, format, bytes, status] = match;
            downloaded.set(format, Number(bytes));
            let sum = 0;
            for (const it of downloaded.values()) sum += it;
            args.onProgress(sum);

            // The ffmpeg merge prints nothing, and a large one can outlast
            // the stall limit, so the limit covers only the download
            if (status === "finished") finished.add(format);
            if (finished.size >= formatCount) control.stopStallWatch();
          } else if (line.trim().length > 0) {
            // The only other stdout line is the one that --print asks for
            path = line.trim();
          }
        },
      },
    );

    if (!path) {
      // --max-filesize makes yt-dlp skip a larger format without an error
      throw new YtDlpError(
        "yt-dlp produced no file, or the file was too large",
      );
    }

    return path;
  },
};

function commonArgs(access: YouTubeAccess, cookieFile?: string): string[] {
  const args = [
    "--ignore-config",
    "--no-playlist",
    "--cache-dir",
    Downloads.cacheDir,
  ];

  switch (access) {
    case "visionos":
      args.push("--extractor-args", "youtube:player_client=visionos");
      break;
    case "default":
      break;
    case "cookie":
      if (!cookieFile) throw new Error("The cookie access needs a cookie file");
      args.push("--cookies", cookieFile);
      break;
  }

  return args;
}

type RunOptions = {
  timeoutMs: number;
  /**
   * Kill the process when stdout stays silent this long
   */
  stallMs?: number;
  /**
   * Receives every stdout line. Without it, run() returns the lines.
   */
  onLine?: (line: string, control: RunControl) => void;
};

type RunControl = {
  /**
   * Ends the stall limit for the rest of the run
   */
  readonly stopStallWatch: () => void;
};

async function run(
  args: string[],
  options: RunOptions,
): Promise<{ lines: string[]; stderr: string }> {
  const child = new Deno.Command(config.YT_DLP_PATH, {
    args,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  let killReason: string | undefined;
  let forceKill: number | undefined;
  const kill = (reason: string) => {
    if (killReason) return;
    killReason = reason;
    signal(child, "SIGTERM");
    // The standalone binary forwards SIGTERM to its Python process. SIGKILL
    // is the fallback when that process does not stop.
    forceKill = setTimeout(() => signal(child, "SIGKILL"), 5_000);
  };

  const timeout = setTimeout(
    () => kill(`yt-dlp did not finish in ${options.timeoutMs / 1000} s`),
    options.timeoutMs,
  );

  let stall: number | undefined;
  let watchStall = options.stallMs !== undefined;
  const control: RunControl = {
    stopStallWatch: () => {
      watchStall = false;
      clearTimeout(stall);
    },
  };
  const resetStall = () => {
    if (!watchStall) return;
    clearTimeout(stall);
    stall = setTimeout(
      () => kill(`yt-dlp received no data for ${options.stallMs! / 1000} s`),
      options.stallMs,
    );
  };
  resetStall();

  const lines: string[] = [];
  const readStdout = async () => {
    for await (const line of readLines(child.stdout)) {
      resetStall();
      if (options.onLine) {
        options.onLine(line, control);
      } else {
        lines.push(line);
      }
    }
  };

  try {
    const [status, stderr] = await Promise.all([
      child.status,
      new Response(child.stderr).text(),
      readStdout(),
    ]);

    if (killReason) throw new YtDlpError(killReason);

    if (!status.success) {
      log.debug(`yt-dlp exited with ${status.code}: ${stderr}`);
      throw new YtDlpError(
        errorLine(stderr) ?? `yt-dlp exited with ${status.code}`,
      );
    }

    return { lines, stderr };
  } finally {
    clearTimeout(timeout);
    clearTimeout(stall);
    clearTimeout(forceKill);
  }
}

function signal(child: Deno.ChildProcess, name: Deno.Signal) {
  try {
    child.kill(name);
  } catch (_e) {
    // The process has already exited
  }
}

/**
 * Turns "ERROR: [youtube] dQw4w9WgXcQ: Video unavailable" into
 * "Video unavailable"
 */
function errorLine(stderr: string): string | undefined {
  const line = stderr.split("\n").findLast((it) => it.startsWith("ERROR:"));
  return line
    ?.replace(/^ERROR:\s*/, "")
    .replace(/^\[[^\]]+\]\s*[\w-]+:\s*/, "");
}

async function* readLines(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  let buffer = "";

  for await (const chunk of stream.pipeThrough(new TextDecoderStream())) {
    buffer += chunk;

    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      yield buffer.slice(0, end).replace(/\r$/, "");
      buffer = buffer.slice(end + 1);
    }
  }

  if (buffer.length > 0) yield buffer;
}
