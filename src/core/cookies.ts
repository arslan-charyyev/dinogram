import { Cookie, CookieJar } from "another-cookiejar";

export function parseCookieString(cookieString: string): CookieJar {
  return new CookieJar(cookieString.split(";").map(Cookie.from));
}
