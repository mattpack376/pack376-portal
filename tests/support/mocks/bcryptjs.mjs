// The real bcryptjs, with optional pause points so a test can hold a password
// hash "in flight" (testState.pauses["bcrypt.hash"]) while it changes the
// database underneath. Without a pause installed it behaves exactly like the
// real package.
import realModule from "bcryptjs";

const state = globalThis.__pack376Test;
const real = realModule.default ?? realModule;

async function pausePoint(name) {
  const pause = state.pauses[name];
  if (pause) await pause();
}

export async function hash(...args) {
  await pausePoint("bcrypt.hash");
  return real.hash(...args);
}
export async function compare(...args) {
  await pausePoint("bcrypt.compare");
  return real.compare(...args);
}
export const { setRandomFallback, genSalt, genSaltSync, hashSync, compareSync, getRounds, getSalt, truncates, encodeBase64, decodeBase64 } = real;

const bcrypt = { ...real, hash, compare };
export default bcrypt;
