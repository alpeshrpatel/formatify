/**
 * avro/snappy.js
 * ---------------------------------------------------------------------------
 * Hand-written Snappy block-format decompressor, used by the Avro reader for
 * the `snappy` codec (the most common compression in the Avro ecosystem).
 *
 * Why hand-written? Snappy's *block format* is compact and fully specified
 * (https://github.com/google/snappy/blob/main/format_description.txt), so a
 * decoder is ~100 lines and keeps the Avro reader dependency-free. We only
 * ever *decompress* — encoding is not needed to read files.
 *
 * The format, briefly:
 *   - a varint32 preamble: the uncompressed length
 *   - a sequence of tagged elements (low 2 bits of the tag byte):
 *       00 literal  — `len` raw bytes copied verbatim
 *       01 copy     — 1-byte little-endian offset, length 4–11
 *       02 copy     — 2-byte little-endian offset, length 1–64
 *       03 copy     — 4-byte little-endian offset, length 1–64
 *   - copies may overlap their own output (that is how runs are encoded),
 *     so they must be expanded byte-by-byte, never with a block copy.
 */

/** IEEE CRC-32 (reflected 0xEDB88332), as required by Avro's snappy codec. */
const CRC_TABLE = /* @__PURE__ */ (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readVarint32(bytes, state) {
  let shift = 0;
  let result = 0;
  for (;;) {
    if (state.pos >= bytes.length) {
      throw new Error(`Truncated Snappy stream: varint preamble runs past the end of the data`);
    }
    const byte = bytes[state.pos++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return result >>> 0;
    shift += 7;
    if (shift > 28) {
      throw new Error('Corrupt Snappy stream: varint preamble is longer than 5 bytes');
    }
  }
}

/**
 * Decompress a Snappy block-format stream.
 * Throws plain `Error`s (the caller wraps them into `AvroError` with context).
 */
export function snappyDecompress(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const state = { pos: 0 };
  const expectedLength = readVarint32(bytes, state);
  const out = new Uint8Array(expectedLength);
  let at = 0;

  while (at < expectedLength) {
    if (state.pos >= bytes.length) {
      throw new Error(
        `Truncated Snappy stream: needed more elements after ${at} of ${expectedLength} bytes`,
      );
    }
    const tag = bytes[state.pos++];
    const kind = tag & 0x03;

    if (kind === 0) {
      // Literal. `tag >>> 2` is (length - 1) for the first 60 values; the
      // four largest (60–63) instead count the little-endian bytes that hold
      // the real (length - 1). Comparing the *shifted* value matters: the
      // raw tag is 4× larger, so `tag >= 60` would misread every literal of
      // length 16–60 as a length header.
      const header = tag >>> 2;
      let length;
      if (header < 60) {
        length = header + 1;
      } else {
        const extra = header - 59; // 1..4 extra length bytes
        if (state.pos + extra > bytes.length) {
          throw new Error('Truncated Snappy stream: literal length bytes run past the end');
        }
        length = 0;
        for (let i = 0; i < extra; i += 1) {
          // Multiplication (not `<< 24`) so the top byte never sign-extends.
          length += bytes[state.pos + i] * 2 ** (8 * i);
        }
        state.pos += extra;
        length += 1; // the stored value is (length - 1)
      }
      if (at + length > expectedLength) {
        throw new Error(
          `Corrupt Snappy stream: literal of ${length} bytes overruns the declared output length`,
        );
      }
      if (state.pos + length > bytes.length) {
        throw new Error('Truncated Snappy stream: literal bytes run past the end of the data');
      }
      out.set(bytes.subarray(state.pos, state.pos + length), at);
      state.pos += length;
      at += length;
    } else {
      // Copy from already-produced output.
      let length;
      let offset;
      if (kind === 1) {
        length = ((tag >>> 2) & 0x07) + 4;
        if (state.pos >= bytes.length) {
          throw new Error('Truncated Snappy stream: copy is missing its offset byte');
        }
        offset = ((tag >>> 5) << 8) | bytes[state.pos];
        state.pos += 1;
      } else if (kind === 2) {
        length = (tag >>> 2) + 1;
        if (state.pos + 2 > bytes.length) {
          throw new Error('Truncated Snappy stream: copy is missing its offset bytes');
        }
        offset = bytes[state.pos] | (bytes[state.pos + 1] << 8);
        state.pos += 2;
      } else {
        length = (tag >>> 2) + 1;
        if (state.pos + 4 > bytes.length) {
          throw new Error('Truncated Snappy stream: copy is missing its offset bytes');
        }
        offset =
          bytes[state.pos] |
          (bytes[state.pos + 1] << 8) |
          (bytes[state.pos + 2] << 16) |
          (bytes[state.pos + 3] << 24);
        state.pos += 4;
      }
      if (offset === 0 || offset > at) {
        throw new Error(
          `Corrupt Snappy stream: copy offset ${offset} is outside the ${at} bytes produced so far`,
        );
      }
      if (at + length > expectedLength) {
        throw new Error(
          `Corrupt Snappy stream: copy of ${length} bytes overruns the declared output length`,
        );
      }
      // Overlapping copies (offset < length) must expand byte-by-byte.
      for (let i = 0; i < length; i += 1) {
        out[at + i] = out[at + i - offset];
      }
      at += length;
    }
  }

  if (state.pos !== bytes.length) {
    throw new Error(
      `Corrupt Snappy stream: ${bytes.length - state.pos} trailing byte(s) after the declared output`,
    );
  }
  return out;
}
