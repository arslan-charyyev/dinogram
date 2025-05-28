import { DinoContext } from "../bot/dinogram.ts";
import { replyWithError } from "./error-handling.ts";
import { log } from "./log.ts";

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

export function getPathSegments(url: URL): string[] {
  return url.pathname
    .split("/")
    .filter(Boolean); // Removes empty strings
}

/**
 * @returns id which may be used to cancel the timeout.
 */
export function runAfter(args: {
  seconds: number;
  callback: () => void;
}) {
  return setTimeout(() => {
    try {
      args.callback();
    } catch (e) {
      log.error("runAfter: unhandled exception. Error: ", e);
    }
  }, args.seconds * 1000);
}

export async function safeRun(
  ctx: DinoContext,
  description: string,
  callback: () => void | Promise<void>,
) {
  try {
    await callback();
  } catch (error) {
    try {
      replyWithError(ctx, description, error);
    } catch (nested) {
      log.error("Error replying with error: ", nested);
      console.error(nested);
    }
  }
}

/**
 * Compares arrays by value
 */
export function arraysAreEqual<T>(a: T[], b: T[]) {
  if (a.length !== b.length) return false;

  return a.every((_, index) => a[index] === b[index]);
}
