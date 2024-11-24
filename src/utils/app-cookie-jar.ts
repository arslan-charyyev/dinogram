import z from "zod";

export class AppCookieJar {
  private cookies: Record<string, string>;

  constructor(cookieString: string) {
    this.cookies = AppCookieJar.cookieStrArrayToObject(cookieString.split(";"));
  }

  get(key: string): string | undefined {
    return this.cookies[key];
  }

  parse() {
    return z.object({
      ds_user_id: z.string().transform(Number).pipe(z.number().int()),
      sessionid: z.string(),
    }).safeParse(this.cookies);
  }

  replaceCookies(newCookieStrings: string[]) {
    const newCookies = AppCookieJar.cookieStrArrayToObject(newCookieStrings);
    this.cookies = {
      ...this.cookies,
      ...newCookies,
    };
  }

  getCookieString(): string {
    return Object.entries(this.cookies)
      .filter(([_, value]) => value)
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
  }

  private static cookieStrArrayToObject(cookies: string[]) {
    return cookies.filter(Boolean)
      .map((it) => it.trim().split(";")[0]) // Remove non key-value data
      .map((it) => it.trim().split("="))
      .reduce((object, [key, value]) => {
        object[key.toLowerCase()] = value;
        return object;
      }, {} as Record<string, string>);
  }
}
