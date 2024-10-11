import { PlatformClient } from "./platform-client.ts";
import { InstagramClient } from "./instagram-client.ts";
import { TikTokClient } from "./tiktok-client.ts";

export class ClientFactory {
  static find(url: URL): PlatformClient | null {
    if (TikTokClient.supportsLink(url)) return new TikTokClient(url);
    if (InstagramClient.supportsLink(url)) return new InstagramClient(url);

    return null;
  }
}
