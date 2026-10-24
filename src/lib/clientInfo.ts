type HeaderList = { get(name: string): string | null };

/**
 * Turns a User-Agent into a short label for the sign-in log: what kind of
 * device, which operating system, which browser — "Phone · iOS · Safari",
 * "Computer · Windows · Chrome", "Automated · curl".
 *
 * The raw header is never stored. It's chosen by whoever is on the other end,
 * so a failed-sign-in log that kept it verbatim would let anyone write text
 * into a page the master admins read; this only ever returns labels from the
 * fixed lists below. Returns null when nothing is recognizable (including no
 * header at all), so an odd client is simply an entry with no device line.
 */
export function deviceLabelFromUserAgent(userAgent: string | null | undefined): string | null {
  const ua = (userAgent ?? "").slice(0, 512);
  if (!ua.trim()) return null;

  // Scripts and crawlers come first: a credential-guessing tool is exactly
  // what a run of failed sign-ins is worth telling apart from a person.
  const automated = AUTOMATED_CLIENTS.find(([pattern]) => pattern.test(ua));
  if (automated) return `Automated · ${automated[1]}`;

  let deviceType: string | null = null;
  let os: string | null = null;
  if (/iPad/i.test(ua)) {
    deviceType = "Tablet";
    os = "iPadOS";
  } else if (/iPhone|iPod/i.test(ua)) {
    deviceType = "Phone";
    os = "iOS";
  } else if (/Android/i.test(ua)) {
    // Android phones say "Mobile"; tablets don't.
    deviceType = /Mobile/i.test(ua) ? "Phone" : "Tablet";
    os = "Android";
  } else if (/Windows/i.test(ua)) {
    deviceType = "Computer";
    os = "Windows";
  } else if (/CrOS/i.test(ua)) {
    deviceType = "Computer";
    os = "ChromeOS";
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    // iPads in desktop mode send this too, so a Mac here can occasionally be one.
    deviceType = "Computer";
    os = "macOS";
  } else if (/Linux|X11/i.test(ua)) {
    deviceType = "Computer";
    os = "Linux";
  }

  // Order matters: Edge, Opera and Chrome-on-iOS all contain "Chrome" or
  // "Safari", and Chrome contains "Safari".
  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1] ?? null;

  const parts = [deviceType, os, browser].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

const AUTOMATED_CLIENTS: [RegExp, string][] = [
  [/curl\//i, "curl"],
  [/wget\//i, "Wget"],
  [/python-requests|python-urllib|aiohttp|httpx/i, "Python script"],
  [/go-http-client/i, "Go script"],
  [/node-fetch|axios|undici/i, "Node script"],
  [/postman|insomnia/i, "API client"],
  [/scrapy|libwww|java\//i, "Script"],
  [/headless/i, "Headless browser"],
  [/bot\b|crawler|spider/i, "Bot"],
];

const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/SamsungBrowser/, "Samsung Internet"],
  [/Firefox\/|FxiOS/, "Firefox"],
  [/CriOS|Chrome\//, "Chrome"],
  [/Safari\//, "Safari"],
];

/**
 * The User-Agent header as a device label — see deviceLabelFromUserAgent.
 * Takes the header list so the caller can pass the one it already awaited.
 */
export function clientDeviceFromHeaders(headerList: HeaderList): string | null {
  return deviceLabelFromUserAgent(headerList.get("user-agent"));
}

/** Longest place string worth keeping; a real "City, ST, CC" is well under this. */
const MAX_LOCATION_LENGTH = 80;

/**
 * A rough "City, Region, Country" for the request, or null when the host
 * didn't say.
 *
 * Read from the x-vercel-ip-* headers Vercel's edge sets from the client
 * address on every request, which a client can't supply itself — the same
 * reason clientIpFromHeaders trusts x-vercel-forwarded-for. There is no
 * fallback: unlike an address, nothing else in a request says where it came
 * from, so local dev and any other host get null rather than a guess.
 *
 * This is where the *network address* sits, which is not always where the
 * person is: a VPN, a mobile carrier or an office network can put someone in
 * another city or state. The viewer says so next to the value.
 *
 * Vercel percent-encodes the city, since header values can't carry non-ASCII
 * ("São Paulo" arrives as "S%C3%A3o%20Paulo").
 */
export function clientLocationFromHeaders(headerList: HeaderList): string | null {
  const parts = [
    decodeHeader(headerList.get("x-vercel-ip-city")),
    decodeHeader(headerList.get("x-vercel-ip-country-region")),
    decodeHeader(headerList.get("x-vercel-ip-country")),
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return null;
  return parts.join(", ").slice(0, MAX_LOCATION_LENGTH);
}

function decodeHeader(value: string | null): string | null {
  if (!value) return null;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Malformed escape: keep the raw text rather than losing the place.
  }
  // Control characters have no business in a place name.
  const cleaned = decoded.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return cleaned || null;
}
