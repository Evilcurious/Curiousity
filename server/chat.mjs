import { chatLimits } from '../shared/chat.mjs';
import { HttpError } from './validation.mjs';

export function chatInput(input) {
  const { providerId, messages } = input || {};
  if (typeof providerId !== 'string' || !providerId || providerId.length > 80) throw new HttpError(400, 'Choose one of your saved AI profiles.');
  if (!Array.isArray(messages) || !messages.length || messages.length % 2 !== 1 || messages.length > chatLimits.pairs * 2 + 1) throw new HttpError(400, 'Send a message in a valid conversation.');
  let bytes = 0;
  const history = messages.map((row, index) => {
    const role = index % 2 ? 'assistant' : 'user';
    const content = typeof row?.content === 'string' ? row.content.trim() : '';
    if (row?.role !== role || !content || content.length > chatLimits[role]) throw new HttpError(400, 'Chat accepts alternating text messages within the message length limit.');
    bytes += Buffer.byteLength(content);
    return { role, content };
  });
  if (bytes > chatLimits.contextBytes) throw new HttpError(400, 'This conversation is too long. Start a new chat.');
  return { providerId, messages: history };
}
