import { PlatformClient } from "./platform-client.ts";
import { config } from "../core/config.ts";
import { TikTokClient } from "./tiktok/tiktok-client.ts";
import { InstagramClient } from "./instagram/instagram-client.ts";

export function findPlatformClient(url: URL): PlatformClient | null {
  if (config.TIKTOK_ENABLED && TikTokClient.supportsLink(url)) {
    return new TikTokClient(url);
  }

  if (config.INSTAGRAM_ENABLED && InstagramClient.supportsLink(url)) {
    return new InstagramClient(url);
  }

  return null;
}
