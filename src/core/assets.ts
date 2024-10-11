import { join } from "@std/path";

export const Assets = {
  img: {
    error: join(Deno.cwd(), "assets/img/error.jpg"),
  },
  js: {
    signature: join(Deno.cwd(), "assets/js/signature.js"),
    webmssdk: join(Deno.cwd(), "assets/js/webmssdk.js"),
  },
};
