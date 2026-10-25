'use strict';
// Incremental top-level fMP4 framing. Never hand an incomplete box to the SDK.
const MAX_BOX = 32 * 1024 * 1024, MAX_GROUP = 64 * 1024 * 1024;
async function* fragments(chunks) {
  const iterator = chunks[Symbol.asyncIterator]();
  let rest = Buffer.alloc(0);
  async function exact(length, allowEnd = false) {
    const parts = []; let remaining = length;
    while (remaining) {
      if (!rest.length) {
        const next = await iterator.next();
        if (next.done) {
          if (allowEnd && remaining === length) return null;
          throw new Error('Truncated MP4 box');
        }
        rest = Buffer.from(next.value);
        if (!rest.length) continue;
      }
      const count = Math.min(remaining, rest.length);
      parts.push(rest.subarray(0, count)); rest = rest.subarray(count); remaining -= count;
    }
    return Buffer.concat(parts, length);
  }
  let init = [], body = [], initBytes = 0, bodyBytes = 0, started = false, count = 0;
  try {
    for (;;) {
      const header = await exact(8, true);
      if (!header) break;
      const type = header.toString('ascii', 4, 8);
      let size = header.readUInt32BE(0), headers = [header], headerSize = 8;
      if (size === 1) {
        const extended = await exact(8); headers.push(extended); headerSize = 16;
        const large = extended.readBigUInt64BE();
        if (large > BigInt(MAX_BOX)) throw new Error('Oversized MP4 box');
        size = Number(large);
      }
      // EOF-sized boxes cannot safely be emitted before the upstream completes.
      if (size < headerSize || size > MAX_BOX) throw new Error('Invalid MP4 box bounds');
      const data = Buffer.concat([...headers, await exact(size - headerSize)], size);
      if (type === 'moof') {
        if (body.length) throw new Error('Missing MP4 media data');
        if (!started) {
          if (!init.length) throw new Error('NoClearInitSegment');
          yield { kind: 'init', data: Buffer.concat(init, initBytes) };
          init = []; started = true;
        }
        body = [data]; bodyBytes = size;
      } else if (body.length) {
        bodyBytes += size;
        if (bodyBytes > MAX_GROUP) throw new Error('Oversized MP4 fragment');
        body.push(data);
        if (type === 'mdat') {
          yield { kind: 'fragment', data: Buffer.concat(body, bodyBytes) };
          body = []; bodyBytes = 0; count++;
        }
      } else if (!started) {
        if (type === 'mdat') throw new Error('NoFragmentedMP4Media');
        initBytes += size;
        if (initBytes > MAX_GROUP) throw new Error('Oversized MP4 header');
        init.push(data);
      } // Trailing index boxes are not media fragments.
    }
    if (body.length) throw new Error('Missing MP4 media data');
    if (!count) throw new Error('NoFragmentedMP4Media');
  } finally { await iterator.return?.(); }
}
module.exports = { fragments };
