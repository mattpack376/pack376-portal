"use client";

const TO = "pack376.brooklyn@gmail.com";
const CC = "matt.pack376@gmail.com";

export default function ContactForm() {
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const name = (form.elements.namedItem("name") as HTMLInputElement).value.trim();
    const scout = (form.elements.namedItem("scout") as HTMLInputElement).value.trim();
    const email = (form.elements.namedItem("email") as HTMLInputElement).value.trim();
    const message = (form.elements.namedItem("message") as HTMLTextAreaElement).value.trim();

    const subject = encodeURIComponent(`Pack 376 Website — message from ${name || "a visitor"}`);
    const body = encodeURIComponent(
      [`Name: ${name}`, `Scout / grade (if applicable): ${scout}`, `Email: ${email}`, "", message].join("\n")
    );
    window.location.href = `mailto:${TO}?cc=${CC}&subject=${subject}&body=${body}`;
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-field">
        <label htmlFor="cf-name">Your Name</label>
        <input type="text" id="cf-name" name="name" required />
      </div>
      <div className="form-field">
        <label htmlFor="cf-scout">Scout&apos;s Name / Grade (if applicable)</label>
        <input type="text" id="cf-scout" name="scout" placeholder="e.g. Ava, entering 2nd grade" />
      </div>
      <div className="form-field">
        <label htmlFor="cf-email">Email</label>
        <input type="email" id="cf-email" name="email" required />
      </div>
      <div className="form-field">
        <label htmlFor="cf-message">Message</label>
        <textarea
          id="cf-message"
          name="message"
          rows={5}
          required
          placeholder="Tell us a bit about what you're looking for..."
        />
      </div>
      <button type="submit" className="btn btn-primary" style={{ width: "100%" }}>
        Send Message
      </button>
    </form>
  );
}
