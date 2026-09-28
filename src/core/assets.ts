import { join } from "@std/path";

export const Assets = {
  img: {
    error: join(Deno.cwd(), "assets/img/error.jpg"),
  },
};
