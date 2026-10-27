import EnlargeableImage from "@/components/EnlargeableImage";
import { flyerDisplay } from "@/lib/flyerDisplay";

/** Thumbnail and enlarged sizes for a flyer image. */
export type FlyerImageSize = { width: number; height: number; enlargedWidth: number; enlargedHeight: number };

/** The size an event card's flyer has always been shown at (the Parent Dashboard's Upcoming Events). */
const CARD_SIZE: FlyerImageSize = { width: 180, height: 230, enlargedWidth: 480, enlargedHeight: 620 };

/** Text for screen readers only: still read out as part of the link, never shown. */
const SCREEN_READER_ONLY: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

/**
 * Renders an event's or trip's uploaded flyer: an enlargeable thumbnail for
 * an image, a link for a PDF (or for any address the image optimizer
 * wouldn't take — see flyerDisplay). Renders nothing if there's no flyer.
 * A PDF never reaches next/image.
 */
export default function EventFlyer({
  flyerUrl,
  title,
  size = CARD_SIZE,
  style,
  linkClassName,
}: {
  flyerUrl: string | null;
  /** The event's title — the image's alt text and the link's accessible name say whose flyer it is. */
  title: string;
  size?: FlyerImageSize;
  style?: React.CSSProperties;
  /** The PDF link's class: a plain link by default, or a button ("btn btn-primary") where it's the page's main flyer. */
  linkClassName?: string;
}) {
  const display = flyerDisplay(flyerUrl);
  if (!flyerUrl || !display) return null;

  if (display !== "image") {
    return (
      <p style={{ marginBottom: 10, ...style }}>
        <FlyerLink flyerUrl={flyerUrl} title={title} className={linkClassName} style={{ fontWeight: 700 }} />
      </p>
    );
  }

  return (
    <div style={{ marginBottom: 10, ...style }}>
      <EnlargeableImage
        src={flyerUrl}
        alt={`${title} flyer`}
        width={size.width}
        height={size.height}
        enlargedWidth={size.enlargedWidth}
        enlargedHeight={size.enlargedHeight}
        fit="contain"
      />
    </div>
  );
}

/**
 * A link to a flyer that says what it opens: "View Flyer (PDF)", or
 * "(image)", plus — for screen readers — whose flyer it is and that it opens
 * in a new tab. An ordinary <a href>, so it's reachable and opens from the
 * keyboard. Renders nothing for a URL that isn't http(s).
 */
export function FlyerLink({
  flyerUrl,
  title,
  text = "View Flyer",
  className = "link",
  style,
}: {
  flyerUrl: string | null;
  title: string;
  /** The visible words before the file type, e.g. "View current flyer". */
  text?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const display = flyerDisplay(flyerUrl);
  if (!flyerUrl || !display) return null;
  const kind = display === "pdf" ? " (PDF)" : display === "image" ? " (image)" : "";

  return (
    <a href={flyerUrl} target="_blank" rel="noopener noreferrer" className={className} style={style}>
      {display === "pdf" && <span aria-hidden="true">📄 </span>}
      {text}
      {kind}
      <span style={SCREEN_READER_ONLY}>{` for ${title}, opens in a new tab`}</span>
      <span aria-hidden="true"> →</span>
    </a>
  );
}
