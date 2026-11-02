// The real next/server, except after(): outside a Next.js request the real
// one throws, so this queues the callback in testState.afterCallbacks for a
// test to run (runAfterCallbacks in ../context.ts). Set
// testState.afterThrows to make it throw like the real one does.
import realModule from "next/server";

const state = globalThis.__pack376Test;
const real = realModule.default ?? realModule;

export const { NextRequest, NextResponse, ImageResponse, userAgentFromString, userAgent, URLPattern, connection } = real;

export function after(task) {
  if (state.afterThrows) throw new Error("after() was called outside a request scope (test)");
  state.afterCallbacks.push(typeof task === "function" ? task : () => task);
}

const nextServer = { ...real, after };
export default nextServer;
