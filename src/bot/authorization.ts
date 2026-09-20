import { config } from "../core/config.ts";

/**
 * A request is authorized when the whitelist is empty, or when it contains at
 * least one of the given IDs. Inline queries carry no chat ID, so the caller
 * passes only the IDs it knows.
 */
export function isRequestAuthorized(...ids: (number | undefined)[]): boolean {
  if (config.WHITELIST.length === 0) return true;

  return ids.some((id) => id !== undefined && config.WHITELIST.includes(id));
}
