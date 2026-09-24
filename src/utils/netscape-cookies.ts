const HEADER = "# Netscape HTTP Cookie File";

/**
 * Rebuilds a cookies.txt file (the Netscape format that yt-dlp reads) from
 * text that a user pasted in chat. Telegram clients may turn the tabs of that
 * format into spaces, so any whitespace separates the fields here, and the
 * result uses tabs again.
 *
 * Returns undefined when the text holds no cookie for youtube.com.
 */
export function parseYouTubeCookies(text: string): string | undefined {
  const lines: string[] = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();

    // A cookie that is not readable by JavaScript starts with #HttpOnly_,
    // which looks like a comment, but is not one
    if (
      line.length === 0 ||
      (line.startsWith("#") && !line.startsWith("#HttpOnly_"))
    ) {
      continue;
    }

    const [domain, subdomains, path, secure, expiry, name, ...value] = line
      .split(/\s+/);

    const isCookie = [subdomains, secure].every((it) =>
      /^(TRUE|FALSE)$/i.test(it ?? "")
    ) &&
      /^\d+$/.test(expiry ?? "") &&
      !!path && !!name;

    if (!isCookie) continue;

    lines.push(
      [
        domain,
        subdomains.toUpperCase(),
        path,
        secure.toUpperCase(),
        expiry,
        name,
        value.join(" "),
      ].join("\t"),
    );
  }

  const hasYouTubeCookie = lines.some((it) =>
    /(^|\.)youtube\.com$/.test(it.split("\t")[0].replace(/^#HttpOnly_/, ""))
  );

  return hasYouTubeCookie ? [HEADER, ...lines, ""].join("\n") : undefined;
}
