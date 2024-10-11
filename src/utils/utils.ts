export function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randStr(min: number, max: number): string {
  const characters = "abcdefghijklmnopqrstuvwxyz";
  const length = randInt(min, max);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += characters.charAt(
      Math.floor(Math.random() * characters.length),
    );
  }
  return result;
}

export function truncate(str: string, maxLength: number): string {
  if (maxLength <= 0) throw new Error("Max length must be greater that 0");

  if (str.length <= maxLength) return str;

  const slice = str.slice(0, maxLength - 1);

  return `${slice}…`;
}

export function getUrlSegments(url: URL): string[] {
  return url.pathname
    .split("/")
    .filter((it) => it.length > 0); // Removes empty strings
}
