// Lenient JSON recovery for plain-chat structured replies: models wrap the
// payload in prose or code fences despite instructions. Finds the outermost
// JSON value between the first bracket and the last matching one. Shared by
// every chat-plus-parse caller (chatJson's validated path, translate).
export function extractLooseJson(text: string): unknown {
  for (const [open, close] of [
    ["[", "]"],
    ["{", "}"],
  ] as const) {
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // fall through to the next bracket pair (or null)
      }
    }
  }
  return null;
}
