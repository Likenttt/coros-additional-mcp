/**
 * Minimal ZIP writer for activity upload.
 *
 * COROS wants the activity file wrapped in `{md5}.zip` containing
 * `{md5}/{originalFilename}`, stored uncompressed.
 *
 * @module
 */

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;

/** Stored, i.e. copied verbatim with no compression. */
const METHOD_STORED = 0;
/** Minimum version needed to extract a stored entry: 1.0. */
const VERSION_NEEDED = 10;
/** Version made by, matching what mainstream writers emit: 2.0. */
const VERSION_MADE_BY = 20;
/** MS-DOS directory attribute, set on the folder entry. */
const DOS_ATTR_DIRECTORY = 0x10;
/**
 * General purpose bit 11: the entry name is UTF-8.
 *
 * Without it an extractor may read the name as CP437, turning `Löpning.fit`
 * into `LÃ¶pning.fit`.
 */
const FLAG_UTF8_NAME = 0x800;

const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let bit = 0; bit < 8; bit++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[i] = c >>> 0;
    }
    return table;
})();

/** CRC-32 (IEEE 802.3), the checksum ZIP entries carry. */
export function crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
        crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Encode a date as the MS-DOS time/date pair, two-second resolution, epoch
 * 1980. Earlier dates clamp to 1980-01-01.
 *
 * UTC, not local: the format nominally stores local time, but the Training Hub
 * web app writes UTC, and it keeps output reproducible.
 */
function toDosDateTime(date: Date): { time: number; date: number } {
    const year = date.getUTCFullYear();
    if (year < 1980) return { time: 0, date: (1 << 5) | 1 };
    return {
        time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1),
        date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
    };
}

interface Entry {
    /** Name as stored, with a trailing slash for directories. */
    name: Uint8Array;
    body: Uint8Array;
    crc: number;
    isDirectory: boolean;
    /** General purpose bit flags; see {@link FLAG_UTF8_NAME}. */
    flags: number;
    /** Byte offset of this entry's local header, filled in while writing. */
    offset: number;
}

/** Declared only for names that are not plain ASCII. */
function flagsFor(name: Uint8Array): number {
    for (let i = 0; i < name.length; i++) {
        if (name[i] >= 0x80) return FLAG_UTF8_NAME;
    }
    return 0;
}

/** Fixed sizes of the records, excluding the variable-length name. */
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const EOCD_SIZE = 22;

/**
 * Build a ZIP containing `entryName`, plus a directory entry for its parent
 * folder when it has one.
 *
 * @param content File bytes, stored uncompressed.
 * @param entryName Path inside the archive, e.g. `"{md5}/activity.fit"`.
 * @param date Modification timestamp; defaults to now.
 */
export function createZipBuffer(content: Uint8Array, entryName: string, date: Date = new Date()): Uint8Array {
    const encoder = new TextEncoder();
    const entries: Entry[] = [];

    const slash = entryName.lastIndexOf("/");
    if (slash !== -1) {
        const dirName = encoder.encode(entryName.slice(0, slash + 1));
        entries.push({
            name: dirName,
            body: new Uint8Array(0),
            crc: 0,
            isDirectory: true,
            flags: flagsFor(dirName),
            offset: 0,
        });
    }
    const fileName = encoder.encode(entryName);
    entries.push({
        name: fileName,
        body: content,
        crc: crc32(content),
        isDirectory: false,
        flags: flagsFor(fileName),
        offset: 0,
    });

    const localSize = entries.reduce((sum, e) => sum + LOCAL_HEADER_SIZE + e.name.length + e.body.length, 0);
    const centralSize = entries.reduce((sum, e) => sum + CENTRAL_HEADER_SIZE + e.name.length, 0);
    const out = new Uint8Array(localSize + centralSize + EOCD_SIZE);
    const view = new DataView(out.buffer);
    const dos = toDosDateTime(date);
    let pos = 0;

    for (const entry of entries) {
        entry.offset = pos;
        view.setUint32(pos, LOCAL_FILE_HEADER, true);
        view.setUint16(pos + 4, VERSION_NEEDED, true);
        view.setUint16(pos + 6, entry.flags, true);
        view.setUint16(pos + 8, METHOD_STORED, true);
        view.setUint16(pos + 10, dos.time, true);
        view.setUint16(pos + 12, dos.date, true);
        view.setUint32(pos + 14, entry.crc, true);
        view.setUint32(pos + 18, entry.body.length, true); // compressed size
        view.setUint32(pos + 22, entry.body.length, true); // uncompressed size
        view.setUint16(pos + 26, entry.name.length, true);
        view.setUint16(pos + 28, 0, true); // extra field length
        pos += LOCAL_HEADER_SIZE;
        out.set(entry.name, pos);
        pos += entry.name.length;
        out.set(entry.body, pos);
        pos += entry.body.length;
    }

    const centralStart = pos;
    for (const entry of entries) {
        view.setUint32(pos, CENTRAL_DIRECTORY_HEADER, true);
        view.setUint16(pos + 4, VERSION_MADE_BY, true);
        view.setUint16(pos + 6, VERSION_NEEDED, true);
        view.setUint16(pos + 8, entry.flags, true);
        view.setUint16(pos + 10, METHOD_STORED, true);
        view.setUint16(pos + 12, dos.time, true);
        view.setUint16(pos + 14, dos.date, true);
        view.setUint32(pos + 16, entry.crc, true);
        view.setUint32(pos + 20, entry.body.length, true); // compressed size
        view.setUint32(pos + 24, entry.body.length, true); // uncompressed size
        view.setUint16(pos + 28, entry.name.length, true);
        view.setUint16(pos + 30, 0, true); // extra field length
        view.setUint16(pos + 32, 0, true); // file comment length
        view.setUint16(pos + 34, 0, true); // disk number start
        view.setUint16(pos + 36, 0, true); // internal attributes
        view.setUint32(pos + 38, entry.isDirectory ? DOS_ATTR_DIRECTORY : 0, true);
        view.setUint32(pos + 42, entry.offset, true);
        pos += CENTRAL_HEADER_SIZE;
        out.set(entry.name, pos);
        pos += entry.name.length;
    }

    view.setUint32(pos, END_OF_CENTRAL_DIRECTORY, true);
    view.setUint16(pos + 4, 0, true); // this disk number
    view.setUint16(pos + 6, 0, true); // disk with central directory
    view.setUint16(pos + 8, entries.length, true);
    view.setUint16(pos + 10, entries.length, true);
    view.setUint32(pos + 12, pos - centralStart, true);
    view.setUint32(pos + 16, centralStart, true);
    view.setUint16(pos + 20, 0, true); // comment length

    return out;
}
