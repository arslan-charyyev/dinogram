export function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randStr(min: number, max: number): string {
  const characters = "abcdefghijklmnopqrstuvwxyz";
  const length = randInt(min, max);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += characters.charAt(
      Math.floor(Math.random() * characters.length),
    );
  }
  return result;
}

export function truncate(str: string, maxLength: number): string {
  if (maxLength <= 0) throw new Error("Max length must be greater that 0");

  if (str.length <= maxLength) return str;

  const slice = str.slice(0, maxLength - 1);

  return `${slice}…`;
}

/**
 * 3.3 MB, 29 MB, 1.4 GB. A size of 0 means unknown.
 */
export function formatSize(bytes: number): string {
  if (bytes <= 0) return "? MB";

  const megabytes = bytes / (1024 * 1024);
  if (megabytes >= 1024) return `${(megabytes / 1024).toFixed(1)} GB`;
  if (megabytes >= 10) return `${Math.round(megabytes)} MB`;
  return `${megabytes.toFixed(1)} MB`;
}

/**
 * 3:33, 1:05:09
 */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.round(totalSeconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");

  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/**
 * Resolves with undefined when the promise fails or takes longer than the
 * given time. The promise itself keeps running.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | undefined> {
  let timer: number | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });

  return Promise.race([promise.catch(() => undefined), timeout])
    .finally(() => clearTimeout(timer));
}

export function getUrlSegments(url: URL): string[] {
  return url.pathname
    .split("/")
    .filter((it) => it.length > 0); // Removes empty strings
}
