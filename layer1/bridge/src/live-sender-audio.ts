/**
 * The live-view sender page's room audio: one message from Layer 3's /mic frame feed as samples
 * the browser can play. The sender page runs this same function, inlined from its source.
 */

/**
 * The samples in one /mic message: `headerBytes` of captured_at, then mono s16le PCM, as floats
 * from -1 to just under 1. A trailing odd byte is left out.
 */
export function micMessageToSamples(message: ArrayBuffer, headerBytes: number): Float32Array {
  const count = Math.floor(Math.max(0, message.byteLength - headerBytes) / 2);
  const samples = new Float32Array(count);
  if (count === 0) return samples;
  const view = new DataView(message, headerBytes, count * 2);
  for (let index = 0; index < count; index += 1) {
    samples[index] = view.getInt16(index * 2, true) / 32768;
  }
  return samples;
}
