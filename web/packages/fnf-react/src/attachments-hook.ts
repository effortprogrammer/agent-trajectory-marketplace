'use client'

import type { AttachmentsMediaClient, AttachmentsOptions } from './attachments'
import { useEffect, useState } from 'react'
import { AttachmentsController } from './attachments'
import { useStore } from './external-store-hook'
import { useOptionalFnfObservability } from './provider'

/**
 * An attachments presenter bound to the component: previews render
 * immediately, uploads run in the background, `refs`/`settled()` feed the
 * submit. Object URLs are revoked on unmount. For an attachments list that
 * must outlive the component (route changes, pools), construct
 * `AttachmentsController` yourself and bind it with `useStore`.
 *
 *   const attachments = useAttachments(media, { upload: { forceIpCheck: true } })
 *   <input type="file" onChange={e => attachments.add([...e.target.files ?? []])} />
 *   {attachments.items.map(a => <Thumb key={a.key} src={a.previewUrl} state={a.status} />)}
 *   <button onClick={async () => submit(await attachments.settled())} />
 */
export function useAttachments(media: AttachmentsMediaClient, opts?: AttachmentsOptions): AttachmentsController {
  const providerObservability = useOptionalFnfObservability()
  const observability = opts?.observability ?? providerObservability
  // useState, not useMemo: items live in the controller; a cache-discard
  // would wipe them. `media` and `opts` are read once — both must be stable.
  const [controller] = useState(() => new AttachmentsController(media, { ...opts, ...(observability ? { observability } : {}) }))
  useEffect(() => () => controller.dispose(), [controller])
  return useStore(controller)
}
