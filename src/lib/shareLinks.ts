/** ShareLinks' addresses for a message `text` and page `url` (see src/components/ShareLinks.tsx). */
export function shareHrefs(text: string, url: string, subject: string) {
  const message = `${text} ${url}`;
  return {
    // "sms:?&body=" is the form both iPhone and Android Messages read.
    sms: `sms:?&body=${encodeURIComponent(message)}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(message)}`,
    email: `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${text}\n\n${url}`)}`,
  };
}
