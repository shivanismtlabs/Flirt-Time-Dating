/**
 * Utility to extract audio duration from audio buffers (M4A/MP4, WAV)
 * Zero external dependencies.
 */

/**
 * Safely extracts duration in seconds from an audio Buffer.
 * Supports:
 * - ISO Base Media / MPEG-4 audio (M4A, MP4, AAC in MP4 container) via 'mvhd' atom
 * - RIFF WAVE (.wav) via 'fmt ' and 'data' chunks
 *
 * Returns duration in integer seconds, or null if unparseable.
 */
export function extractAudioDuration(buffer: Buffer, mimeType?: string): number | null {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 16) {
    return null;
  }

  try {
    // 1. Check ISO Media (M4A, MP4)
    const m4aSecs = parseIsoMediaDuration(buffer);
    if (m4aSecs !== null && m4aSecs > 0) {
      return Math.max(1, Math.round(m4aSecs));
    }

    // 2. Check RIFF / WAV
    const wavSecs = parseWavDuration(buffer);
    if (wavSecs !== null && wavSecs > 0) {
      return Math.max(1, Math.round(wavSecs));
    }
  } catch (err: any) {
    // Non-blocking fallback
  }

  return null;
}

/**
 * Parses duration from ISO Base Media File Format (M4A, MP4, 3GP, MOV)
 * Reads the timescale and duration from the 'mvhd' (Movie Header) atom.
 */
function parseIsoMediaDuration(buf: Buffer): number | null {
  let offset = 0;
  const len = buf.length;

  while (offset + 8 <= len) {
    let boxSize = buf.readUInt32BE(offset);
    const boxType = buf.toString('ascii', offset + 4, offset + 8);

    if (boxSize === 0) {
      boxSize = len - offset;
    } else if (boxSize === 1) {
      if (offset + 16 > len) break;
      const high = buf.readUInt32BE(offset + 8);
      const low = buf.readUInt32BE(offset + 12);
      boxSize = high * 4294967296 + low;
    }

    if (boxSize < 8 || offset + boxSize > len) {
      break;
    }

    if (boxType === 'moov') {
      const moovResult = parseMoovBox(buf.subarray(offset + 8, offset + boxSize));
      if (moovResult !== null) return moovResult;
    }

    offset += boxSize;
  }

  // Fallback: search directly for 'mvhd' marker anywhere in the buffer
  const mvhdMarker = Buffer.from('mvhd');
  const mvhdIdx = buf.indexOf(mvhdMarker);
  if (mvhdIdx >= 4 && mvhdIdx + 24 <= buf.length) {
    return readMvhdPayload(buf, mvhdIdx + 4);
  }

  return null;
}

function parseMoovBox(moovBuf: Buffer): number | null {
  let offset = 0;
  while (offset + 8 <= moovBuf.length) {
    let boxSize = moovBuf.readUInt32BE(offset);
    const boxType = moovBuf.toString('ascii', offset + 4, offset + 8);

    if (boxSize === 0) boxSize = moovBuf.length - offset;
    if (boxSize < 8 || offset + boxSize > moovBuf.length) break;

    if (boxType === 'mvhd') {
      return readMvhdPayload(moovBuf, offset + 8);
    }

    offset += boxSize;
  }
  return null;
}

function readMvhdPayload(buf: Buffer, payloadOffset: number): number | null {
  if (payloadOffset + 20 > buf.length) return null;
  const version = buf.readUInt8(payloadOffset);

  if (version === 0) {
    // version 0: 4 bytes (version + flags)
    // 4 bytes creation time, 4 bytes modification time
    // 4 bytes timescale, 4 bytes duration
    const timescale = buf.readUInt32BE(payloadOffset + 12);
    const duration = buf.readUInt32BE(payloadOffset + 16);
    if (timescale > 0 && duration > 0) {
      return duration / timescale;
    }
  } else if (version === 1) {
    // version 1: 4 bytes (version + flags)
    // 8 bytes creation time, 8 bytes modification time
    // 4 bytes timescale, 8 bytes duration
    if (payloadOffset + 28 > buf.length) return null;
    const timescale = buf.readUInt32BE(payloadOffset + 20);
    const durationHigh = buf.readUInt32BE(payloadOffset + 24);
    const durationLow = buf.readUInt32BE(payloadOffset + 28);
    const duration = durationHigh * 4294967296 + durationLow;
    if (timescale > 0 && duration > 0) {
      return duration / timescale;
    }
  }
  return null;
}

/**
 * Parses duration from WAV (RIFF WAVE) container
 */
function parseWavDuration(buf: Buffer): number | null {
  if (buf.length < 44) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }

  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;

  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);

    if (chunkId === 'fmt ' && offset + 16 <= buf.length) {
      byteRate = buf.readUInt32LE(offset + 16); // byteRate is at offset 8 within fmt chunk (payloadOffset + 8)
    } else if (chunkId === 'data') {
      dataSize = chunkSize;
      break;
    }

    offset += 8 + chunkSize;
  }

  if (byteRate > 0 && dataSize > 0) {
    return dataSize / byteRate;
  }
  return null;
}
