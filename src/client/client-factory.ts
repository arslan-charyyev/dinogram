import { PlatformClient } from "./platform-client.ts";
import { InstagramClient } from "./instagram-client.ts";
import { PinterestClient } from "./pinterest-client.ts";
import { TikTokClient } from "./tiktok-client.ts";
import { config } from "../core/config.ts";

export class ClientFactory {
  static find(url: URL): PlatformClient | null {
    if (config.TIKTOK_ENABLED && TikTokClient.supportsLink(url)) {
      return new TikTokClient(url);
    }

    if (config.INSTAGRAM_ENABLED && InstagramClient.supportsLink(url)) {
      return new InstagramClient(url);
    }

    if (config.PINTEREST_ENABLED && PinterestClient.supportsLink(url)) {
      return new PinterestClient(url);
    }

    return null;
  }
}
