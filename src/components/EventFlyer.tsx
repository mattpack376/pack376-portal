import EnlargeableImage from "@/components/EnlargeableImage";

/** Renders an event's uploaded flyer — an enlargeable thumbnail for images, or a link for PDFs. Renders nothing if there's no flyer. */
export default function EventFlyer({ flyerUrl, title }: { flyerUrl: string | null; title: string }) {
  if (!flyerUrl) return null;

  if (flyerUrl.toLowerCase().endsWith(".pdf")) {
    return (
      <p style={{ marginBottom: 10 }}>
        <a href={flyerUrl} target="_blank" rel="noopener noreferrer" className="link" style={{ fontWeight: 700 }}>
          📄 View Flyer (PDF) →
        </a>
      </p>
    );
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <EnlargeableImage
        src={flyerUrl}
        alt={`${title} flyer`}
        width={180}
        height={230}
        enlargedWidth={480}
        enlargedHeight={620}
        fit="contain"
      />
    </div>
  );
}
