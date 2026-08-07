import EnlargeableImage from "@/components/EnlargeableImage";

export default function PaymentInstructionsCard() {
  return (
    <div className="info-card">
      <h3 style={{ marginTop: 0 }}>💳 How to Pay</h3>
      <p>Pay by cash to Dianaliz or Matt at any meeting, or send a Zelle payment using the QR code below.</p>
      <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
        <EnlargeableImage
          src="/zelle-payment-qr.png"
          alt="Zelle QR code for GNYC BSA Pack 3376F — Matt.pack376@gmail.com"
          width={120}
          height={118}
        />
        <p style={{ marginBottom: 0 }}>
          <strong>Zelle:</strong> Matt.pack376@gmail.com
        </p>
      </div>
    </div>
  );
}
