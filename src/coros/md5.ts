/**
 * MD5, for the login password transform and upload file identity.
 *
 * Web Crypto has no MD5 and `node:crypto` is unavailable in the browser, so the
 * implementation is vendored: `deno_std@0.160.0/hash/md5.ts`, unchanged apart
 * from formatting and the wrapper. See NOTICE.
 *
 * Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
 *
 * @module
 */

const HEX = "0123456789abcdef";

/** Lowercase hex. */
function toHex(bytes: Uint8Array): string {
    let out = "";
    for (let i = 0; i < bytes.length; i++) {
        out += HEX[bytes[i] >> 4] + HEX[bytes[i] & 0x0f];
    }
    return out;
}

/** Raw 16-byte MD5 digest. A byte view hashes its own contents, respecting `byteOffset`. */
export function md5Bytes(input: string | Uint8Array): Uint8Array {
    return new Uint8Array(md5Raw(input));
}

/** MD5 of `input` as lowercase hex. */
export function md5Hex(input: string | Uint8Array): string {
    return toHex(md5Bytes(input));
}

/** MD5 of `input` as base64, as required by the OSS `Content-MD5` header. */
export function md5Base64(input: string | Uint8Array): string {
    const digest = md5Bytes(input);
    let binary = "";
    for (const byte of digest) binary += String.fromCharCode(byte);
    return btoa(binary);
}

// Narrowed from the upstream `BufferSource | string`, which a
// `Uint8Array<ArrayBufferLike>` is not assignable to.
const md5Raw = (data: string | Uint8Array): ArrayBuffer => {
    const msg: Uint8Array = typeof data === "string" ? new TextEncoder().encode(data) : data;

    let state: State = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
    let block: Uint8Array = new Uint8Array(BLOCK_SIZE);
    let pos = 0;
    let n0 = 0;
    let n1 = 0;

    [state, block, pos, n0, n1] = update(state, block, pos, n0, n1, msg);

    let padLen = BLOCK_SIZE - pos;
    if (padLen < 9) padLen += BLOCK_SIZE;

    const pad = new Uint8Array(padLen);

    pad[0] = 0x80;

    [n0, n1] = [n0 << 3, (n1 << 3) | (n0 >>> 29)];
    pad[pad.length - 8] = n0 & 0xff;
    pad[pad.length - 7] = (n0 >>> 8) & 0xff;
    pad[pad.length - 6] = (n0 >>> 16) & 0xff;
    pad[pad.length - 5] = (n0 >>> 24) & 0xff;
    pad[pad.length - 4] = n1 & 0xff;
    pad[pad.length - 3] = (n1 >>> 8) & 0xff;
    pad[pad.length - 2] = (n1 >>> 16) & 0xff;
    pad[pad.length - 1] = (n1 >>> 24) & 0xff;

    [state, block, pos, n0, n1] = update(
        state,
        block,
        pos,
        n0,
        n1,
        new Uint8Array(pad.buffer),
    );

    const hash = new ArrayBuffer(16);
    const hashView = new DataView(hash);
    hashView.setUint32(0, state[0], true);
    hashView.setUint32(4, state[1], true);
    hashView.setUint32(8, state[2], true);
    hashView.setUint32(12, state[3], true);

    return hash;
};

const BLOCK_SIZE = 64;
const rol32 = (x: number, n: number): number => (x << n) | (x >>> (32 - n));

const blk = (block: Uint8Array, i: number): number =>
    block[i] |
    (block[i + 1] << 8) |
    (block[i + 2] << 16) |
    (block[i + 3] << 24);

type State = readonly [number, number, number, number];

const hash = (state: State, block: Uint8Array): State => {
    let [a, b, c, d] = state;
    const x0 = blk(block, 0);
    const x1 = blk(block, 4);
    const x2 = blk(block, 8);
    const x3 = blk(block, 12);
    const x4 = blk(block, 16);
    const x5 = blk(block, 20);
    const x6 = blk(block, 24);
    const x7 = blk(block, 28);
    const x8 = blk(block, 32);
    const x9 = blk(block, 36);
    const xa = blk(block, 40);
    const xb = blk(block, 44);
    const xc = blk(block, 48);
    const xd = blk(block, 52);
    const xe = blk(block, 56);
    const xf = blk(block, 60);

    // round 1
    a = b + rol32((((c ^ d) & b) ^ d) + a + x0 + 0xd76aa478, 7);
    d = a + rol32((((b ^ c) & a) ^ c) + d + x1 + 0xe8c7b756, 12);
    c = d + rol32((((a ^ b) & d) ^ b) + c + x2 + 0x242070db, 17);
    b = c + rol32((((d ^ a) & c) ^ a) + b + x3 + 0xc1bdceee, 22);
    a = b + rol32((((c ^ d) & b) ^ d) + a + x4 + 0xf57c0faf, 7);
    d = a + rol32((((b ^ c) & a) ^ c) + d + x5 + 0x4787c62a, 12);
    c = d + rol32((((a ^ b) & d) ^ b) + c + x6 + 0xa8304613, 17);
    b = c + rol32((((d ^ a) & c) ^ a) + b + x7 + 0xfd469501, 22);
    a = b + rol32((((c ^ d) & b) ^ d) + a + x8 + 0x698098d8, 7);
    d = a + rol32((((b ^ c) & a) ^ c) + d + x9 + 0x8b44f7af, 12);
    c = d + rol32((((a ^ b) & d) ^ b) + c + xa + 0xffff5bb1, 17);
    b = c + rol32((((d ^ a) & c) ^ a) + b + xb + 0x895cd7be, 22);
    a = b + rol32((((c ^ d) & b) ^ d) + a + xc + 0x6b901122, 7);
    d = a + rol32((((b ^ c) & a) ^ c) + d + xd + 0xfd987193, 12);
    c = d + rol32((((a ^ b) & d) ^ b) + c + xe + 0xa679438e, 17);
    b = c + rol32((((d ^ a) & c) ^ a) + b + xf + 0x49b40821, 22);

    // round 2
    a = b + rol32((((b ^ c) & d) ^ c) + a + x1 + 0xf61e2562, 5);
    d = a + rol32((((a ^ b) & c) ^ b) + d + x6 + 0xc040b340, 9);
    c = d + rol32((((d ^ a) & b) ^ a) + c + xb + 0x265e5a51, 14);
    b = c + rol32((((c ^ d) & a) ^ d) + b + x0 + 0xe9b6c7aa, 20);
    a = b + rol32((((b ^ c) & d) ^ c) + a + x5 + 0xd62f105d, 5);
    d = a + rol32((((a ^ b) & c) ^ b) + d + xa + 0x02441453, 9);
    c = d + rol32((((d ^ a) & b) ^ a) + c + xf + 0xd8a1e681, 14);
    b = c + rol32((((c ^ d) & a) ^ d) + b + x4 + 0xe7d3fbc8, 20);
    a = b + rol32((((b ^ c) & d) ^ c) + a + x9 + 0x21e1cde6, 5);
    d = a + rol32((((a ^ b) & c) ^ b) + d + xe + 0xc33707d6, 9);
    c = d + rol32((((d ^ a) & b) ^ a) + c + x3 + 0xf4d50d87, 14);
    b = c + rol32((((c ^ d) & a) ^ d) + b + x8 + 0x455a14ed, 20);
    a = b + rol32((((b ^ c) & d) ^ c) + a + xd + 0xa9e3e905, 5);
    d = a + rol32((((a ^ b) & c) ^ b) + d + x2 + 0xfcefa3f8, 9);
    c = d + rol32((((d ^ a) & b) ^ a) + c + x7 + 0x676f02d9, 14);
    b = c + rol32((((c ^ d) & a) ^ d) + b + xc + 0x8d2a4c8a, 20);

    // round 3
    a = b + rol32((b ^ c ^ d) + a + x5 + 0xfffa3942, 4);
    d = a + rol32((a ^ b ^ c) + d + x8 + 0x8771f681, 11);
    c = d + rol32((d ^ a ^ b) + c + xb + 0x6d9d6122, 16);
    b = c + rol32((c ^ d ^ a) + b + xe + 0xfde5380c, 23);
    a = b + rol32((b ^ c ^ d) + a + x1 + 0xa4beea44, 4);
    d = a + rol32((a ^ b ^ c) + d + x4 + 0x4bdecfa9, 11);
    c = d + rol32((d ^ a ^ b) + c + x7 + 0xf6bb4b60, 16);
    b = c + rol32((c ^ d ^ a) + b + xa + 0xbebfbc70, 23);
    a = b + rol32((b ^ c ^ d) + a + xd + 0x289b7ec6, 4);
    d = a + rol32((a ^ b ^ c) + d + x0 + 0xeaa127fa, 11);
    c = d + rol32((d ^ a ^ b) + c + x3 + 0xd4ef3085, 16);
    b = c + rol32((c ^ d ^ a) + b + x6 + 0x04881d05, 23);
    a = b + rol32((b ^ c ^ d) + a + x9 + 0xd9d4d039, 4);
    d = a + rol32((a ^ b ^ c) + d + xc + 0xe6db99e5, 11);
    c = d + rol32((d ^ a ^ b) + c + xf + 0x1fa27cf8, 16);
    b = c + rol32((c ^ d ^ a) + b + x2 + 0xc4ac5665, 23);

    // round 4
    a = b + rol32((c ^ (b | ~d)) + a + x0 + 0xf4292244, 6);
    d = a + rol32((b ^ (a | ~c)) + d + x7 + 0x432aff97, 10);
    c = d + rol32((a ^ (d | ~b)) + c + xe + 0xab9423a7, 15);
    b = c + rol32((d ^ (c | ~a)) + b + x5 + 0xfc93a039, 21);
    a = b + rol32((c ^ (b | ~d)) + a + xc + 0x655b59c3, 6);
    d = a + rol32((b ^ (a | ~c)) + d + x3 + 0x8f0ccc92, 10);
    c = d + rol32((a ^ (d | ~b)) + c + xa + 0xffeff47d, 15);
    b = c + rol32((d ^ (c | ~a)) + b + x1 + 0x85845dd1, 21);
    a = b + rol32((c ^ (b | ~d)) + a + x8 + 0x6fa87e4f, 6);
    d = a + rol32((b ^ (a | ~c)) + d + xf + 0xfe2ce6e0, 10);
    c = d + rol32((a ^ (d | ~b)) + c + x6 + 0xa3014314, 15);
    b = c + rol32((d ^ (c | ~a)) + b + xd + 0x4e0811a1, 21);
    a = b + rol32((c ^ (b | ~d)) + a + x4 + 0xf7537e82, 6);
    d = a + rol32((b ^ (a | ~c)) + d + xb + 0xbd3af235, 10);
    c = d + rol32((a ^ (d | ~b)) + c + x2 + 0x2ad7d2bb, 15);
    b = c + rol32((d ^ (c | ~a)) + b + x9 + 0xeb86d391, 21);

    return [
        (state[0] + a) >>> 0,
        (state[1] + b) >>> 0,
        (state[2] + c) >>> 0,
        (state[3] + d) >>> 0,
    ];
};

const update = (
    state: State,
    block: Uint8Array,
    pos: number,
    n0: number,
    n1: number,
    msg: Uint8Array,
): [State, Uint8Array, number, number, number] => {
    const free = BLOCK_SIZE - pos;

    if (msg.length < free) {
        block.set(msg, pos);
        pos += msg.length;
    } else {
        // hash first block
        block.set(msg.slice(0, free), pos);
        state = hash(state, block);

        // hash as many blocks as possible
        let i = free;
        while (i + BLOCK_SIZE <= msg.length) {
            state = hash(state, msg.slice(i, i + BLOCK_SIZE));
            i += BLOCK_SIZE;
        }

        // store leftover
        block.fill(0).set(msg.slice(i), 0);
        pos = msg.length - i;
    }

    [n0, n1] = addLength(n0, n1, msg.length);
    return [state, block, pos, n0, n1];
};

const addLength = (n0: number, n1: number, len: number): [number, number] => {
    n0 += len;
    if (n0 > 0xffffffff) n1 += 1;
    return [n0 >>> 0, n1];
};
