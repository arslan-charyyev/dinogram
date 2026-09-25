import crypto from "node:crypto";

export const test_url = {
  tiktok: {
    video: "https://www.tiktok.com/@blackscreen.__/video/6904103492093283589",
    photos: "https://www.tiktok.com/@ma.dishe4ka/photo/7381933376762137873",
    requires_sign_in: "https://vt.tiktok.com/ZSYpchYqS/",
    video_large_content: "https://vt.tiktok.com/ZS2byCTYy/",
  },
  instagram: {
    single_image: "https://www.instagram.com/instagram/p/Cnr0t5oOrgC/",
    images_only: "https://www.instagram.com/p/DdHyaYAifb6/",
    images_with_videos: "https://www.instagram.com/p/CyWn_tQyKAH",
    video: "https://www.instagram.com/reel/C_TNM2ivzHF/",
  },
  pinterest: {
    image: "https://www.pinterest.com/pin/858146903966145189/",
    regional_image: "https://www.pinterest.ca/pin/412994228343400946/",
    video: "https://www.pinterest.com/pin/70437485604616/",
    story_video:
      "https://www.pinterest.com/pin/gadget-cool-products-amazon-product-technology-kitchen-gadgets--1084663891475263837/",
    hls_only_video: "https://www.pinterest.com/pin/63824519713049795/",
    multi_page: "https://jp.pinterest.com/pin/858146904010573850/",
    carousel: "https://www.pinterest.com/pin/1196337405828254/",
    gif: "https://www.pinterest.com/pin/35888128285791877/",
    // A 3840×2160 original
    high_res: "https://www.pinterest.com/pin/9359111718946929/",
    // A 12.8 MB PNG original, above the photo limit of Telegram
    oversized: "https://www.pinterest.com/pin/36732553207657029/",
    vimeo: "https://www.pinterest.ca/pin/441282463481903715/",
    not_found: "https://www.pinterest.com/pin/858146903966145188/",
    short_link: "https://pin.it/42pZ430rg",
    short_link_to_board: "https://pin.it/72hPRLLfr",
  },
};

/**
 * @see https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest
 */
export async function computeSHA1(
  array: Uint8Array,
): Promise<string> {
  const hashBuffer = await crypto.subtle.digest(
    "SHA-1",
    array,
  );
  const hashArray = Array.from(new Uint8Array(hashBuffer)); // convert buffer to byte array
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(""); // convert bytes to hex string
  return hashHex;
}

export async function writeToTestOutput(bytes: Uint8Array, filename: string) {
  await Deno.writeFile(`./test_output/${filename}`, bytes);
}
