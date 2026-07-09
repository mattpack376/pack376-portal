import "server-only";
import { randomBytes } from "node:crypto";

/** Easy to read aloud/write down, no ambiguous separators. */
export function generatePassword() {
  return randomBytes(9).toString("base64url");
}
