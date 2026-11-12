// Complete 1x1 GIF89a: looping red/blue frames, each held for 100 ms.
// LZW streams contain clear, palette index (0/1), end; no image conversion.
export const ANIMATED_GIF = Buffer.from([
  '47494638396101000100800000ff00000000ff',
  '21ff0b4e45545343415045322e300301000000',
  '21f904040a0000002c0000000001000100000202440100',
  '21f904040a0000002c00000000010001000002024c0100',
  '3b',
].join(''), 'hex');
