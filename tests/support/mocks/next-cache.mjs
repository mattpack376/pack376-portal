const state = globalThis.__pack376Test;
export function revalidatePath(path) {
  state.revalidated.push(path);
}
export function revalidateTag(tag) {
  state.revalidated.push(`tag:${tag}`);
}
