// Request-scoped headers and cookies come from the AsyncLocalStorage store set
// up by runAs()/asAnonymous() in tests/support/context.ts.
const state = globalThis.__pack376Test;

function store() {
  const current = state.als.getStore();
  if (!current) throw new Error("next/headers used outside runAs()/asAnonymous() in a test");
  return current;
}

export async function headers() {
  return store().headers;
}

export async function cookies() {
  const jar = store().cookies;
  return {
    get(name) {
      return jar.has(name) ? { name, value: jar.get(name) } : undefined;
    },
    has(name) {
      return jar.has(name);
    },
    set(nameOrOptions, value) {
      if (typeof nameOrOptions === "object") jar.set(nameOrOptions.name, nameOrOptions.value);
      else jar.set(nameOrOptions, value);
    },
    delete(nameOrOptions) {
      jar.delete(typeof nameOrOptions === "object" ? nameOrOptions.name : nameOrOptions);
    },
  };
}
