import { db } from "../core/db.ts";

const ALL_ITEMS_PREFIX = "all-";
const ALL_ITEMS_PAYLOAD = /^all-([0-9a-f]{32})$/;

/**
 * An inline message holds one media item, so its button opens the private
 * chat with the bot, which sends the whole post there. A start payload holds
 * at most 64 characters, which is too short for most links. Thus the payload
 * names a stored link, and the name is a hash of the link, so a repeated share
 * reuses the entry.
 */
export async function allItemsLink(
  botUsername: string,
  url: URL,
): Promise<string> {
  const id = await linkId(url);
  await db.inline.link.set([id], url.toString());

  return `https://t.me/${botUsername}?start=${allItemsPayload(id)}`;
}

export async function linkId(url: URL): Promise<string> {
  const bytes = new TextEncoder().encode(url.toString());
  const hash = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

export function allItemsPayload(id: string): string {
  return ALL_ITEMS_PREFIX + id;
}

/**
 * Returns the ID of the stored link, or null for a payload of another kind
 */
export function parseAllItemsPayload(payload: string): string | null {
  return ALL_ITEMS_PAYLOAD.exec(payload)?.[1] ?? null;
}

/**
 * Returns null when the stored link has expired
 */
export async function findAllItemsLink(id: string): Promise<URL | null> {
  const link = await db.inline.link.get([id]);
  return link ? new URL(link) : null;
}
