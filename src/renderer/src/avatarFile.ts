/**
 * A chosen picture is square-cropped and downscaled before it ever leaves the
 * renderer: the state file keeps a predictable 256px thumbnail rather than
 * whatever multi-megabyte original the person picked out of their photo
 * library, and every place that draws the avatar gets the same square. PNG
 * output preserves transparent backgrounds used by logos and illustrations.
 */
const SIZE = 256

export async function readAvatarFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.')
  const source = await loadImage(file)
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This picture could not be prepared.')
  // Centre crop: the short edge decides the square, so nothing is squashed.
  const edge = Math.min(source.width, source.height)
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, (source.width - edge) / 2, (source.height - edge) / 2, edge, edge, 0, 0, SIZE, SIZE)
  if ('close' in source) source.close()
  return canvas.toDataURL('image/png')
}

async function loadImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file)
  const url = URL.createObjectURL(file)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('This picture could not be read.'))
      image.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}
