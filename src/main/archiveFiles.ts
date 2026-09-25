import { gunzipSync } from 'node:zlib'
import { extract } from 'tar-stream'
import { fromBuffer, type Entry, type ZipFile } from 'yauzl'
import { isSafeSkillPath, MAX_SKILL_BYTES } from '../shared/agentCustomization'

export async function readArchiveFiles(data: Uint8Array): Promise<Map<string, Buffer>> {
  if (!(data instanceof Uint8Array) || !data.length || data.length > MAX_SKILL_BYTES) throw new Error('ZIP must be at most 64 MB.')
  const zip = await new Promise<ZipFile>((resolve, reject) => fromBuffer(Buffer.from(data), { lazyEntries: true, strictFileNames: true }, (error, file) => error ? reject(error) : resolve(file!)))
  const files = new Map<string, Buffer>()
  const archivePaths: string[] = []
  let total = 0
  let entries = 0
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('error', reject)
      zip.on('end', resolve)
      zip.on('entry', (entry: Entry) => {
        void (async () => {
          if (++entries > 2000) throw new Error('ZIP contains too many files (maximum 2,000).')
          const path = entry.fileName
          if (path.split('/').some(part => part === '__MACOSX' || part === '.DS_Store' || part.startsWith('._'))) { zip.readEntry(); return }
          if (!isSafeSkillPath(path.replace(/\/$/, ''))) throw new Error('ZIP contains an unsafe file path.')
          const mode = (entry.externalFileAttributes >>> 16) & 0xf000
          if (mode && mode !== 0x8000 && mode !== 0x4000) throw new Error('ZIP may only contain regular files and folders.')
          if (path.endsWith('/')) { zip.readEntry(); return }
          if (files.has(path.toLowerCase())) throw new Error('ZIP contains duplicate file paths.')
          total += entry.uncompressedSize
          if (total > MAX_SKILL_BYTES) throw new Error('Extracted skills exceed 64 MB.')
          const stream = await new Promise<NodeJS.ReadableStream>((res, rej) => zip.openReadStream(entry, (error, value) => error ? rej(error) : res(value!)))
          const chunks: Buffer[] = []
          let size = 0
          for await (const chunk of stream) {
            size += chunk.length
            if (size > entry.uncompressedSize || size > MAX_SKILL_BYTES) throw new Error('Invalid ZIP file size.')
            chunks.push(Buffer.from(chunk))
          }
          files.set(path.toLowerCase(), Buffer.concat(chunks))
          archivePaths.push(path)
          zip.readEntry()
        })().catch(reject)
      })
      zip.readEntry()
    })
  } finally { zip.close() }
  return new Map(archivePaths.map(path => [path, files.get(path.toLowerCase())!]))
}

/** ZIP or gzip-compressed tar; never extract untrusted files onto the host. */
export async function readAgentArchiveFiles(data: Uint8Array): Promise<Map<string, Buffer>> {
  if (!(data instanceof Uint8Array) || !data.length || data.length > MAX_SKILL_BYTES) throw new Error('Archive must be at most 64 MB.')
  if (data[0] !== 0x1f || data[1] !== 0x8b) return readArchiveFiles(data)
  const tar = gunzipSync(data, { maxOutputLength: MAX_SKILL_BYTES + 4 * 1024 * 1024 })
  const parser = extract()
  const files = new Map<string, Buffer>(), paths = new Set<string>()
  let total = 0, count = 0
  await new Promise<void>((resolve, reject) => {
    parser.on('error', reject)
    parser.on('finish', resolve)
    parser.on('entry', (header, stream, next) => {
      void (async () => {
        if (++count > 2000) throw new Error('Archive contains too many entries (maximum 2,000).')
        const path = header.name.replace(/^(\.\/)+/, '').replace(/\/$/, '')
        if ((!path || path === '.') && header.type === 'directory') { stream.resume(); next(); return }
        if (!isSafeSkillPath(path)) throw new Error('Archive contains an unsafe file path.')
        if (!['file', 'directory'].includes(header.type ?? '')) throw new Error('Archive may only contain regular files and folders.')
        total += header.size ?? 0
        if (total > MAX_SKILL_BYTES) throw new Error('Extracted files exceed 64 MB.')
        const chunks: Buffer[] = []
        for await (const chunk of stream) chunks.push(Buffer.from(chunk))
        if (header.type === 'file' && !path.split('/').some(part => part === '__MACOSX' || part === '.DS_Store' || part.startsWith('._'))) {
          if (paths.has(path.toLowerCase())) throw new Error('Archive contains duplicate file paths.')
          paths.add(path.toLowerCase()); files.set(path, Buffer.concat(chunks))
        }
        next()
      })().catch(error => { stream.destroy(); parser.destroy(error); reject(error) })
    })
    parser.end(tar)
  })
  return files
}
