export const chatLimits = Object.freeze({ pairs: 10, user: 6000, assistant: 8000, contextBytes: 40_000 });

export function chatContext(history, prompt) {
  const encoder = new TextEncoder();
  const messages = [{ role: 'user', content: prompt }];
  let bytes = encoder.encode(prompt).byteLength;
  for (let i = history.length - 2; i >= 0 && messages.length <= chatLimits.pairs * 2; i -= 2) {
    const pair = history.slice(i, i + 2);
    const size = pair.reduce((total, row) => total + encoder.encode(row.content).byteLength, 0);
    if (bytes + size > chatLimits.contextBytes) break;
    messages.unshift(...pair);
    bytes += size;
  }
  return messages;
}
