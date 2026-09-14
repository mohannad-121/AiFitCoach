export interface StreamReply { reply: string; conversation_id?: string; language?: string; action?: string; data?: Record<string, unknown> }
export async function readChatStream(response: Response, onText: (text: string) => void): Promise<StreamReply> {
  if (!response.body) throw new Error('The response stream is unavailable.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let reply: StreamReply | undefined;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer = (buffer + decoder.decode(value, { stream: !done })).replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const event = frame.split('\n').find(line => line.startsWith('event:'))?.slice(6).trim();
        const raw = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!raw) continue;
        const data = JSON.parse(raw);
        if (event === 'delta' && typeof data.text === 'string') onText(data.text);
        if (event === 'done') { reply = data; return reply; }
        if (event === 'error') throw Object.assign(new Error(data.message || 'Unable to complete this reply.'), { code: data.code, limitReached: String(data.code || '').endsWith('_LIMIT_REACHED') });
      }
      if (done) break;
    }
    throw new Error('The connection ended before the reply was complete.');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
