/**
 * Minimal ZIP writer (STORE method, no compression) for bundling a few downloaded resumes into one file.
 * Resumes are PDFs / Word files that are already compressed, so storing them loses nothing.
 */

let crcTable: Uint32Array | null = null

function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i += 1) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Names safe for every OS, unique inside the archive ("Ananya_Rao.pdf", "Ananya_Rao (2).pdf"). */
export function uniqueZipNames(names: string[]): string[] {
  const seen = new Map<string, number>()
  return names.map((raw) => {
    const printable = Array.from(raw, (ch) => (ch.charCodeAt(0) < 32 ? '_' : ch)).join('')
    const clean = printable.replace(/[\\/:*?"<>|]+/g, '_').replace(/^\.+/, '').trim().slice(0, 120) || 'resume'
    const key = clean.toLowerCase()
    const count = seen.get(key) ?? 0
    seen.set(key, count + 1)
    if (!count) return clean
    const dot = clean.lastIndexOf('.')
    return dot > 0 ? `${clean.slice(0, dot)} (${count + 1})${clean.slice(dot)}` : `${clean} (${count + 1})`
  })
}

export function buildZip(files: { name: string; data: Uint8Array }[]): Blob {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const names = uniqueZipNames(files.map((f) => f.name))

  files.forEach((file, i) => {
    const name = enc.encode(names[i])
    const crc = crc32(file.data)
    const size = file.data.length

    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true) // version needed
    lv.setUint16(6, 0x0800, true) // UTF-8 names
    lv.setUint16(8, 0, true) // store
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true)
    lv.setUint32(22, size, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    parts.push(local, file.data)

    const entry = new Uint8Array(46 + name.length)
    const cv = new DataView(entry.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, size, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    entry.set(name, 46)
    central.push(entry)

    offset += local.length + size
  })

  const centralSize = central.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  return new Blob([...parts, ...central, end] as BlobPart[], { type: 'application/zip' })
}

export { crc32 as zipCrc32 }
