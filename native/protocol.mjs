// Chrome/Edge native messaging framing: each message is a 4-byte little-endian length followed by UTF-8 JSON.

const MAX_MESSAGE_BYTES = 1024 * 1024;

export function encodeMessage(value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

/** Returns { push(chunk) } that calls onMessage(value) for every complete message. */
export function createDecoder(onMessage) {
  let buffer = Buffer.alloc(0);
  return {
    push(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const length = buffer.readUInt32LE(0);
        if (length > MAX_MESSAGE_BYTES) throw new Error('Native message too large');
        if (buffer.length < 4 + length) return;
        const body = buffer.subarray(4, 4 + length).toString('utf8');
        buffer = buffer.subarray(4 + length);
        onMessage(JSON.parse(body));
      }
    },
  };
}
