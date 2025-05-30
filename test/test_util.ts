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
    images_only: "https://www.instagram.com/p/B8pUDhTFZVj",
    images_with_videos: "https://www.instagram.com/p/CyWn_tQyKAH",
    video: "https://www.instagram.com/reel/C_TNM2ivzHF/",
    requires_18_plus:
      "https://www.instagram.com/reel/DHsxLZACsnt/?igsh=MXQ2dnMxaDV0eGRydQ==",
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
