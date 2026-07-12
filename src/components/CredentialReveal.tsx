import type { CreatedCredential } from "@/lib/actions/dens";

export default function CredentialReveal({
  credential,
  emailedTo,
}: {
  credential?: CreatedCredential;
  emailedTo?: string;
}) {
  if (emailedTo) {
    return (
      <div className="info-card" style={{ borderLeft: "6px solid var(--teal)", marginTop: 16 }}>
        <p style={{ marginBottom: 0, fontWeight: 700, color: "var(--scout-blue-dark)" }}>
          ✉️ Password emailed to {emailedTo}.
        </p>
      </div>
    );
  }

  if (!credential) return null;

  return (
    <div className="info-card" style={{ borderLeft: "6px solid var(--teal)", marginTop: 16 }}>
      <p style={{ marginBottom: 8, fontWeight: 700, color: "var(--scout-blue-dark)" }}>
        Save this now — shown only once:
      </p>
      <p style={{ fontFamily: "monospace", fontSize: 15, marginBottom: 0 }}>
        <strong>{credential.username}</strong> / {credential.password}
      </p>
    </div>
  );
}
