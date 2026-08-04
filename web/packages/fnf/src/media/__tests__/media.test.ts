import { describe, expect, it } from 'vitest'
import { createMediaClient } from '../client'

describe('submit-ready media refs', () => {
  it('normalizes raw upload-plane labels while preserving job discriminators', async () => {
    const media = createMediaClient({
      mediaAdapter: {
        async getMedia() {
          return { id: 'video-1', type: 'video', url: 'https://cdn/video.mp4' }
        },
        async listMedia() {
          return {
            items: [
              { id: 'image-1', type: 'image', url: 'https://cdn/image.png' },
              { id: 'job-1', type: 'image_job', url: 'https://cdn/job.png' },
            ],
          }
        },
      },
    })

    await expect(media.get('video-1', 'video')).resolves.toMatchObject({ type: 'video_input' })
    await expect(media.list({ type: 'image' })).resolves.toMatchObject({
      items: [{ type: 'media_input' }, { type: 'image_job' }],
    })
  })
})
