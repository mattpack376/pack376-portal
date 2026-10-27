// Mirrors Next's behavior closely enough for tests: both throw, and the thrown
// error carries where it was going so a test can assert on it.
export class RedirectError extends Error {
  constructor(url) {
    super(`NEXT_REDIRECT ${url}`);
    this.redirect = url;
  }
}
export function redirect(url) {
  throw new RedirectError(url);
}
export function notFound() {
  const error = new Error("NEXT_NOT_FOUND");
  error.notFound = true;
  throw error;
}
