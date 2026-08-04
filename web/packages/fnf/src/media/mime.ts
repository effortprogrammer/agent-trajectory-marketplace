import type { UploadType } from './types'

// Ported from fnf-mcp-server src/tools/media/mime.ts so the SDK derives
// content-type / upload-type the same way the server does.

export function inferUploadType(contentType: string): UploadType {
  if (contentType.startsWith('video/'))
    return 'video'
  if (contentType.startsWith('audio/'))
    return 'audio'
  return 'image'
}

export function inferContentType(filename: string | undefined, contentType: string | undefined): string {
  const normalized = contentType?.trim()
  if (normalized)
    return normalized

  const ext = filename?.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    case 'mp4':
    case 'm4v':
      return 'video/mp4'
    case 'mov':
      return 'video/quicktime'
    case 'webm':
      return 'video/webm'
    case 'mp3':
      return 'audio/mpeg'
    case 'm4a':
      return 'audio/mp4'
    case 'wav':
      return 'audio/wav'
    case 'ogg':
      return 'audio/ogg'
    case 'png':
    default:
      return 'image/png'
  }
}

export function defaultFilenameForContentType(contentType: string, type: UploadType): string {
  switch (contentType) {
    case 'image/jpeg':
      return 'upload.jpg'
    case 'image/webp':
      return 'upload.webp'
    case 'image/gif':
      return 'upload.gif'
    case 'video/mp4':
      return 'upload.mp4'
    case 'video/quicktime':
      return 'upload.mov'
    case 'video/webm':
      return 'upload.webm'
    case 'audio/mpeg':
      return 'upload.mp3'
    case 'audio/mp4':
      return 'upload.m4a'
    case 'audio/wav':
      return 'upload.wav'
    case 'audio/ogg':
      return 'upload.ogg'
    default:
      return type === 'video' ? 'upload.mp4' : type === 'audio' ? 'upload.mp3' : 'upload.png'
  }
}
