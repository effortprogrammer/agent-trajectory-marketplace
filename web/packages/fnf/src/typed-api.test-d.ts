import type { FnfObservabilityOptions, FnfObservationEvent, FnfObservationPhase, FnfObserver, GenerationBackend, ProfileBackend } from './index'
/* Type-level checks for the model/settings autocomplete on submit.
 * Checked by `tsc` (included in src/**), not run by vitest (not a *.test.ts).
 * Backends are declared, not constructed — the concrete adapters live in
 * @higgsfield/fnf-adapters (typed there); only the ports matter here. */
import {
  bytedanceVideoUpscale,
  createJobClient,
  createNoopObserver,
  createObservabilityContext,
  createProfileClient,
  defineJob,
  gptImage2,
  grokImagine,
  grokImagineV15,
  happyHorse,
  higgsfieldVideoUpscale,
  kling3_0,
  kling3MotionControl,
  nanoBanana2,
  nanoBanana2Upscale,
  nanoBananaFlash,
  recraftV41Image,
  RecraftV41Model,
  seedance2_0,
  Seedance2AspectRatio,
  seedreamV4_5,
  soraEnhanceVideo,
  soulCinemaImage,
  soulV2Image,
  topazImageGenerativeUpscale,
  topazImageUpscale,
  topazVideoUpscale,
  veo3_1Lite,
  wan27,
  z,
} from './index'

declare const backend: GenerationBackend
declare const profileBackend: ProfileBackend

const client = createJobClient({
  adapter: backend,
  jobs: [nanoBanana2, seedance2_0], // ← the source of autocomplete
})

const imageClient = createJobClient({
  adapter: backend,
  jobs: [soulV2Image, soulCinemaImage, gptImage2, seedreamV4_5, nanoBanana2, nanoBananaFlash, nanoBanana2Upscale, recraftV41Image, topazImageUpscale, topazImageGenerativeUpscale],
})

const videoClient = createJobClient({
  adapter: backend,
  jobs: [seedance2_0, kling3_0, kling3MotionControl, happyHorse, grokImagine, grokImagineV15, veo3_1Lite, wan27, topazVideoUpscale, higgsfieldVideoUpscale, soraEnhanceVideo, bytedanceVideoUpscale],
})

const profileClient = createProfileClient({
  profileAdapter: profileBackend,
})

const observer: FnfObserver = (event) => {
  expectType<FnfObservationEvent>(event)
  expectType<FnfObservationPhase>(event.phase)
  expectType<string>(event.id)
  expectType<string>(event.traceId)
  expectType<string | number | boolean | null | undefined>(event.attributes.model)
}

const observabilityOptions: FnfObservabilityOptions = {
  observer,
  traceId: 'trace-1',
  attributes: { app: 'typed-api', debug: true, count: 1, empty: null },
}

void createObservabilityContext(observabilityOptions)
void createNoopObserver()

// @ts-expect-error observability attributes accept only primitive metadata values
const badObservabilityOptions: FnfObservabilityOptions = { attributes: { unsafe: { nested: true } } }
void badObservabilityOptions

declare function expectType<T>(value: T): void

// model autocompletes to the registered job set types; settings typed per model
void client.submit({ model: 'nano_banana_2', prompt: { instruction: 'x' }, settings: { aspectRatio: '1:1', resolution: '2k' } })
void client.submit({ model: 'seedance_2_0', settings: { duration: 10, aspectRatio: '16:9' } })

// optional/defaulted settings may be omitted (nano: resolution defaults; seedance: seed optional)
void client.submit({ model: 'nano_banana_2', settings: { aspectRatio: '1:1' } })
void client.submit({ model: 'seedance_2_0', settings: { duration: 8, aspectRatio: '16:9' } })

// @ts-expect-error duration is required for seedance_2_0
void client.submit({ model: 'seedance_2_0', settings: { aspectRatio: '16:9' } })

// @ts-expect-error unknown model
void client.submit({ model: 'not_a_model', settings: {} })

// @ts-expect-error wrong resolution enum value
void client.submit({ model: 'nano_banana_2', settings: { aspectRatio: '1:1', resolution: '8k' } })

// @ts-expect-error settings from a different model
void client.submit({ model: 'nano_banana_2', settings: { duration: 5 } })

// aspectRatio is the literal union of the model's allowed ratios
// @ts-expect-error '5:5' is not a nano_banana_2 aspect ratio
void client.submit({ model: 'nano_banana_2', settings: { aspectRatio: '5:5' } })

// seedance duration is a continuous 4–15 range (plain number type; range enforced at runtime)
void client.submit({ model: 'seedance_2_0', settings: { duration: 7, aspectRatio: '16:9' } })

// object-enum members are accepted interchangeably with raw values (structural, not nominal)
void client.submit({ model: 'seedance_2_0', settings: { duration: 8, aspectRatio: Seedance2AspectRatio.r16x9 } })

void imageClient.submit({ model: 'text2image_soul_v2', settings: { aspectRatio: '3:4', quality: '1080p' } })
void imageClient.submit({ model: 'soul_cinematic', settings: { cinematicVariant: 'sultan', batchSize: 2 } })
void imageClient.submit({ model: 'gpt_image_2', prompt: { instruction: 'x' }, settings: { aspectRatio: 'auto', quality: 'high', resolution: '2k', subModel: 'videotape-alpha' } })
void imageClient.submit({ model: 'seedream_v4_5', prompt: { instruction: 'x' }, settings: { aspectRatio: '3:4', quality: 'basic' } })
void imageClient.submit({ model: 'nano_banana_flash', prompt: { instruction: 'x' }, media: { image: { id: 'u', type: 'media_input' } }, settings: { resolution: '2k' } })
void imageClient.submit({ model: 'nano_banana_2_upscale', media: { image: { id: 'u', type: 'media_input' } }, settings: { resolution: '4k', aspectRatio: '16:9' } })
void imageClient.submit({ model: 'recraft_v4_1', prompt: { instruction: 'x' }, settings: { model: RecraftV41Model.vector, resolution: '2k', colors: ['#ffffff'] } })
void imageClient.submit({ model: 'topaz_image', media: { image: { id: 'u', type: 'media_input' } }, settings: { sourceWidth: 512, sourceHeight: 512, factor: 'x2', model: 'Standard V2' } })
void imageClient.submit({ model: 'topaz_image_generative', prompt: { instruction: 'restore' }, media: { image: { id: 'u', type: 'media_input' } }, settings: { sourceWidth: 512, sourceHeight: 512, creativity: 2, texture: 2, detail: 1 } })

void videoClient.submit({ model: 'seedance_2_0', prompt: { instruction: 'x' }, settings: { duration: 5, aspectRatio: '16:9', mode: 'fast', bitrateMode: 'high' } })
void videoClient.submit({ model: 'kling3_0', prompt: { instruction: 'x', enhance: true }, media: { start_image: { id: 's', type: 'media_input' } }, settings: { duration: 5, aspectRatio: '16:9', mode: 'std', sound: 'off', multiShotMode: 'auto' } })
void videoClient.submit({ model: 'kling3_0_motion_control', media: { image: { id: 'i', type: 'media_input' }, video: { id: 'v', type: 'video_input' } }, settings: { mode: 'pro', characterOrientation: 'video', isChain: true, backgroundSource: 'input_video' } })
void videoClient.submit({ model: 'happy_horse_video', prompt: { instruction: 'x' }, settings: { resolution: '1080p', aspectRatio: '3:4', duration: 5, batchSize: 2 } })
void videoClient.submit({ model: 'grok_video', prompt: { instruction: 'x' }, settings: { resolution: '720p', aspectRatio: 'auto', duration: 6 } })
void videoClient.submit({ model: 'grok_video_v15', prompt: { instruction: 'x' }, media: { start_image: { id: 's', type: 'media_input' } }, settings: { resolution: '480p', duration: 2 } })
void videoClient.submit({ model: 'veo3_1_lite', prompt: { instruction: 'x' }, media: { start_image: { id: 's', type: 'media_input' }, end_image: { id: 'e', type: 'media_input' } }, settings: { resolution: '720p', aspectRatio: 'auto', duration: 8, generateAudio: true } })
void videoClient.submit({ model: 'wan2_7', prompt: { instruction: 'x', negative: 'blur' }, settings: { quality: '1080p', aspectRatio: '4:3', duration: 5 } })
void videoClient.submit({ model: 'topaz_video', media: { video: { id: 'v', type: 'video_input' } }, settings: { sourceWidth: 1280, sourceHeight: 720, model: 'slp-2.5', enhancementModel: 'iris-3', frameInterpolationFps: 60 } })
void videoClient.submit({ model: 'video_upscale', media: { video: { id: 'v', type: 'video_input' } }, settings: { sourceWidth: 1280, sourceHeight: 720, scaleFactor: '4k' } })
void videoClient.submit({ model: 'video_deflicker', media: { video: { id: 'v', type: 'video_input' } }, settings: { sourceWidth: 1280, sourceHeight: 720 } })
void videoClient.submit({ model: 'bytedance_video_upscale', media: { video: { id: 'v', type: 'video_input' } }, settings: { sourceWidth: 1280, sourceHeight: 720, resolution: '2k', preset: 'aigc', fps: 60 } })

void profileClient.getUser().then((user) => {
  if (user) {
    expectType<string | null>(user.workspaceId)
    expectType<'private' | 'shared' | null>(user.workspaceType)
    expectType<'owner' | 'admin' | 'member' | null>(user.workspaceRole)
    expectType<string | null>(user.planType)
    expectType<string | null>(user.billingPeriod)
    expectType<number>(user.totalPlanCredits)
    // @ts-expect-error profile user fields are camelCase in the SDK
    expectType<unknown>(user.workspace_id)
  }
})

void profileClient.listWorkspaces().then((workspaces) => {
  expectType<string | null | undefined>(workspaces[0]?.clerkOrganizationId)
  expectType<string | null | undefined>(workspaces[0]?.avatarUrl)
  // @ts-expect-error workspace fields are camelCase in the SDK
  expectType<unknown>(workspaces[0]?.clerk_organization_id)
})

void profileClient.getCredits({ includeOnDemand: true }).then((credits) => {
  expectType<number | undefined>(credits?.totalAvailableCredits)
  expectType<number | undefined>(credits?.raw.totalAvailableCredits)
})

void profileClient.switchWorkspace({ workspaceId: 'workspace-1' }).then((snapshot) => {
  expectType<string | undefined>(snapshot.currentWorkspace?.id)
  expectType<number | undefined>(snapshot.credits?.availablePercent)
})

// @ts-expect-error switchWorkspace accepts camelCase workspaceId only
void profileClient.switchWorkspace({ workspace_id: 'workspace-1' })

// @ts-expect-error GPT Image 2 has a closed resolution enum
void imageClient.submit({ model: 'gpt_image_2', prompt: { instruction: 'x' }, settings: { resolution: '8k' } })

// @ts-expect-error Nano Banana 2 declares only the image media role
void imageClient.submit({ model: 'nano_banana_flash', prompt: { instruction: 'x' }, media: { bogus: { id: 'u', type: 'media_input' } }, settings: {} })

// @ts-expect-error Nano Banana 2 Upscale has a closed resolution enum
void imageClient.submit({ model: 'nano_banana_2_upscale', media: { image: { id: 'u', type: 'media_input' } }, settings: { resolution: '1k' } })

// @ts-expect-error Topaz image has a closed factor enum
void imageClient.submit({ model: 'topaz_image', media: { image: { id: 'u', type: 'media_input' } }, settings: { factor: 'x3' } })

// @ts-expect-error Recraft model is the frontend discriminator, not any arbitrary string
void imageClient.submit({ model: 'recraft_v4_1', prompt: { instruction: 'x' }, settings: { model: 'recraft-v5' } })

// @ts-expect-error Seedance Fast does not use a separate registered model id
void videoClient.submit({ model: 'seedance2_0_fast', prompt: { instruction: 'x' }, settings: { duration: 5, aspectRatio: '16:9' } })

// @ts-expect-error Kling 3.0 has a closed mode enum
void videoClient.submit({ model: 'kling3_0', prompt: { instruction: 'x' }, settings: { duration: 5, aspectRatio: '16:9', mode: 'turbo' } })

// @ts-expect-error Motion Control declares only image/video media roles
void videoClient.submit({ model: 'kling3_0_motion_control', media: { start_image: { id: 's', type: 'media_input' } }, settings: { mode: 'std' } })

// @ts-expect-error Grok Imagine has a closed resolution enum
void videoClient.submit({ model: 'grok_video', prompt: { instruction: 'x' }, settings: { resolution: '1080p' } })

// @ts-expect-error Veo 3.1 Lite duration is 4 | 6 | 8
void videoClient.submit({ model: 'veo3_1_lite', prompt: { instruction: 'x' }, settings: { duration: 5 } })

// @ts-expect-error Wan 2.7 exposes quality, not arbitrary resolutions
void videoClient.submit({ model: 'wan2_7', prompt: { instruction: 'x' }, settings: { quality: '4k' } })

// @ts-expect-error Topaz video has a closed enhancement model enum
void videoClient.submit({ model: 'topaz_video', media: { video: { id: 'v', type: 'video_input' } }, settings: { enhancementModel: 'unknown' } })

// @ts-expect-error Bytedance video has a closed preset enum
void videoClient.submit({ model: 'bytedance_video_upscale', media: { video: { id: 'v', type: 'video_input' } }, settings: { preset: 'cinematic' } })

// @ts-expect-error Video upscale declares only the video media role
void videoClient.submit({ model: 'video_upscale', media: { image: { id: 'i', type: 'media_input' } }, settings: {} })

// media keys are narrowed to the job's declared roles
void client.submit({ model: 'seedance_2_0', settings: { duration: 8, aspectRatio: '16:9' }, media: { start_image: { id: 'u', type: 'media_input' } } })
// @ts-expect-error 'bogus' is not a declared media role of seedance_2_0
void client.submit({ model: 'seedance_2_0', settings: { duration: 8, aspectRatio: '16:9' }, media: { bogus: { id: 'u', type: 'media_input' } } })

// A job that declares no media and no prompt exposes neither in its input type.
const textOnly = defineJob({
  jobSetType: 'text_only',
  outputType: 'image',
  params: {
    settings: { steps: z.number() },
  },
  // credits receives the TYPED settings of this model
  credits: ({ settings }) => settings.steps * 2,
})

void defineJob({
  jobSetType: 'priced_t',
  outputType: 'image',
  params: { settings: { steps: z.number() } },
  // @ts-expect-error 'nope' is not a settings key of this model
  credits: ({ settings }) => settings.nope,
})
const textClient = createJobClient({ adapter: backend, jobs: [textOnly] })
void textClient.submit({ model: 'text_only', settings: { steps: 4 } })
// @ts-expect-error this job declares no prompt
void textClient.submit({ model: 'text_only', settings: { steps: 4 }, prompt: { instruction: 'x' } })
// @ts-expect-error this job declares no media
void textClient.submit({ model: 'text_only', settings: { steps: 4 }, media: { image: { id: 'u', type: 'media_input' } } })
