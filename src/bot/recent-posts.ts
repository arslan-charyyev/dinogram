import type { PlatformClient } from "../client/platform-client.ts";
import type { FilePost } from "../model/post.ts";

/**
 * A post and the client that fetched it. Some platforms accept a download
 * link only with the cookies that the client got with the post, so the
 * download must go through the same client.
 */
export type RecentPost = {
  readonly client: PlatformClient;
  readonly post: Promise<FilePost>;
};

/**
 * The post that answers an inline query also serves the chosen result, so the
 * platform gets one request instead of two. The download links of a post stay
 * valid much longer than an entry lives here.
 */
export class RecentPosts {
  readonly #entries = new Map<string, RecentPost>();

  constructor(private readonly lifetimeMs: number) {}

  /**
   * Gives the entry of the link, and fetches the post with the client when
   * there is no entry. A client given for a link that has an entry goes
   * unused, because only the client of the entry holds its cookies.
   */
  fetch(url: URL, client: PlatformClient): RecentPost {
    const key = url.toString();

    const entry = this.#entries.get(key);
    if (entry) return entry;

    const created = { client, post: client.fetchPost() };
    this.#entries.set(key, created);

    // A failed fetch leaves at once, so that the chosen result tries again
    created.post.then(
      () => setTimeout(() => this.#entries.delete(key), this.lifetimeMs),
      () => this.#entries.delete(key),
    );

    return created;
  }
}
