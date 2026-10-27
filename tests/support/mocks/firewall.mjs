const state = globalThis.__pack376Test;
export async function checkRateLimit() {
  return { rateLimited: state.rateLimited };
}
