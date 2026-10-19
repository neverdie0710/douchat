import { nativeImage } from 'electron'

/**
 * Images the web app asks the desktop for travel back as one sync record,
 * which the service caps at 1.8 MB of JSON. Leave room for the rest of it.
 */
export const REMOTE_IMAGE_MAX = 1_200_000
const STEPS: readonly (readonly [side: number, quality: number])[] = [[2048, 85], [1600, 80], [1280, 75], [1024, 70], [768, 65]]

/** The image as is when it fits, else a smaller JPEG preview of it (JPEG has no transparency). */
export function fitImageForSync(dataUrl: string, max = REMOTE_IMAGE_MAX): string {
  if (dataUrl.length <= max) return dataUrl
  const image = nativeImage.createFromDataURL(dataUrl)
  if (image.isEmpty()) throw new Error('This image could not be read.')
  const { width, height } = image.getSize()
  for (const [side, quality] of STEPS) {
    const scale = Math.min(1, side / Math.max(width, height))
    const sized = scale < 1 ? image.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'best' }) : image
    const preview = `data:image/jpeg;base64,${sized.toJPEG(quality).toString('base64')}`
    if (preview.length <= max) return preview
  }
  throw new Error('This image is too large to show in the web app. Open it in the Douchat desktop app.')
}
