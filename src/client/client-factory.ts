import { PlatformClient } from "./platform-client.ts";
import { InstagramClient } from "./instagram-client.ts";
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

    return null;
  }
}
