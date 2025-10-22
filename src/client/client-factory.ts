import { PlatformClient } from "./platform-client.ts";
import { InstagramClient } from "./instagram-client.ts";
import { TikTokClient } from "./tiktok-client.ts";
import { config } from "../core/config.ts";
import { YouTubeClient } from "./youtube-client.ts";

export class ClientFactory {
  static find(url: URL): PlatformClient | null {
    if (config.TIKTOK_ENABLED && TikTokClient.supportsLink(url)) {
      return new TikTokClient(url);
    }

    if (config.INSTAGRAM_ENABLED && InstagramClient.supportsLink(url)) {
      return new InstagramClient(url);
    }

    if (config.YOUTUBE_ENABLED && YouTubeClient.supportsLink(url)) {
      return new YouTubeClient(url);
    }

    return null;
  }
}
