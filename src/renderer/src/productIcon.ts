/**
 * App icons with their transparent margins cropped away, so an icon drawn with
 * padding shows at the same size as an edge-to-edge one (as Snapok's settings
 * do). The image is read with fetch, which /api/product-icon allows from any
 * origin, then redrawn as a square PNG data URL. Undefined when it cannot be
 * read (offline, or an icon served without CORS); callers show it untrimmed.
 */

const SIZE = 128
const trimmed = new Map<string, Promise<string | undefined>>()

export function trimmedIcon(url: string): Promise<string | undefined> {
  let pending = trimmed.get(url)
  if (!pending) {
    pending = trim(url).catch(() => undefined)
    trimmed.set(url, pending)
  }
  return pending
}

async function trim(url: string): Promise<string | undefined> {
  const response = await fetch(url)
  if (!response.ok) return undefined
  const bitmap = await createImageBitmap(await response.blob())
  const { width, height } = bitmap
  const source = document.createElement('canvas')
  source.width = width
  source.height = height
  const context = source.getContext('2d', { willReadFrequently: true })
  if (!context) return undefined
  context.drawImage(bitmap, 0, 0)
  const pixels = context.getImageData(0, 0, width, height).data
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] <= 8) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < minX) return undefined
  // Keep it square, centered on the drawn part, so the icon is not stretched.
  const side = Math.min(Math.max(maxX - minX + 1, maxY - minY + 1), width, height)
  const left = Math.min(Math.max(0, Math.round((minX + maxX + 1 - side) / 2)), width - side)
  const top = Math.min(Math.max(0, Math.round((minY + maxY + 1 - side) / 2)), height - side)
  const output = document.createElement('canvas')
  output.width = SIZE
  output.height = SIZE
  output.getContext('2d')?.drawImage(source, left, top, side, side, 0, 0, SIZE, SIZE)
  return output.toDataURL('image/png')
}
