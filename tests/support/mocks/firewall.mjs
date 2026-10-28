const state = globalThis.__pack376Test;
// Records each check (rule ID and the key the app chose) so tests can see
// which bucket a form counted against; rateLimitError fakes a missing rule.
export async function checkRateLimit(rateLimitId, options) {
  state.rateLimitCalls.push({ rateLimitId, rateLimitKey: options?.rateLimitKey });
  if (state.rateLimitError) return { rateLimited: false, error: state.rateLimitError };
  return { rateLimited: state.rateLimited };
}
