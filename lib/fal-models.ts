// Comprehensive model registry with accurate parameters per model
// Based on official fal.ai documentation

export type ModelCategory = 'image' | 'video'
export type InputType = 'text' | 'image' | 'video'

export interface ModelConfig {
  id: string
  name: string
  falModel: string
  editModel?: string            // fal endpoint to use when a reference image is supplied
  imageParam?: 'image_url' | 'image_urls' | 'start_image_url'  // how the reference image is passed (default image_url)
  // Reference-image support (subject/style refs, distinct from first/end frame):
  referenceParam?: 'image_urls' | 'elements' | 'input_image_urls' | 'subject_reference_image_url'
  referenceModel?: string       // separate endpoint for references (omit if refs ride the editModel, e.g. Kling v3 elements)
  referenceCite?: '@Image' | '@Element'  // prompt citation token the model needs (auto-appended)
  category: ModelCategory
  inputTypes: InputType[]
  aspectRatios: string[]
  durations?: string[]          // Only for video models
  resolutions?: string[]        // Optional resolution control
  supportsAudio?: boolean       // For video models with sound generation
  supportsLoop?: boolean        // For video models with loop option
  // True when the model declares 'text' in inputTypes but a prompt is
  // not required to run it. Used by Topaz: empty prompt → plug-n-play
  // endpoint, filled prompt → creative endpoint. Submit-route validation
  // skips the "prompt required" check when this is set.
  optionalPrompt?: boolean
  defaultAspectRatio: string
  defaultDuration?: string
  defaultResolution?: string
  description: string
}

// ============================================
// MODEL REGISTRY - Accurate specs per model
// ============================================

export const FAL_MODELS: ModelConfig[] = [
  // ===== IMAGE MODELS =====
  
  {
    id: 'nano-banana-2',
    name: 'Nano Banana 2',
    falModel: 'fal-ai/nano-banana-2',
    editModel: 'fal-ai/nano-banana-2/edit',
    imageParam: 'image_urls',
    category: 'image',
    inputTypes: ['text', 'image'],
    // Supports extreme aspect ratios
    aspectRatios: ['auto', '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16', '4:1', '1:4', '8:1', '1:8'],
    resolutions: ['0.5K', '1K', '2K', '4K'],
    defaultAspectRatio: 'auto',
    defaultResolution: '1K',
    description: 'Fast multimodal with extreme aspect ratio support'
  },
  
  {
    id: 'nano-banana-pro',
    name: 'Nano Banana Pro',
    falModel: 'fal-ai/nano-banana-pro',
    editModel: 'fal-ai/nano-banana-pro/edit',
    imageParam: 'image_urls',
    category: 'image',
    inputTypes: ['text', 'image'],
    aspectRatios: ['auto', '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'],
    resolutions: ['1K', '2K', '4K'],
    defaultAspectRatio: '1:1',
    defaultResolution: '1K',
    description: 'Higher quality multimodal generation'
  },
  
  {
    id: 'flux-schnell',
    name: 'FLUX Schnell',
    falModel: 'fal-ai/flux/schnell',
    category: 'image',
    inputTypes: ['text'],
    aspectRatios: ['21:9', '16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16'],
    defaultAspectRatio: '16:9',
    description: 'Fast 12B flow transformer, 4 steps'
  },
  
  {
    id: 'flux-dev',
    name: 'FLUX Dev',
    falModel: 'fal-ai/flux/dev',
    editModel: 'fal-ai/flux/dev/image-to-image',
    imageParam: 'image_url',
    category: 'image',
    inputTypes: ['text', 'image'],
    aspectRatios: ['21:9', '16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16'],
    defaultAspectRatio: '16:9',
    description: 'High quality 12B model, 28 steps'
  },

  {
    id: 'kling-o1',
    name: 'Kling o1',
    falModel: 'fal-ai/kling-image/o1',
    editModel: 'fal-ai/kling-image/o1',
    imageParam: 'image_urls',
    category: 'image',
    inputTypes: ['text', 'image'],
    aspectRatios: ['auto', '21:9', '16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16'],
    resolutions: ['1K', '2K'],
    defaultAspectRatio: 'auto',
    defaultResolution: '1K',
    description: 'Precise image edits with multi-image reference'
  },

  // ===== 2026 IMAGE MODELS =====
  // Added based on the fal.ai 2026 directory + best-of-2026 articles.
  // GPT Image 2 / FLUX.2 Pro / Ideogram v4 are the three image models
  // that consistently rank above everything else in current benchmarks.

  {
    id: 'gpt-image-2',
    name: 'GPT Image 2',
    falModel: 'openai/gpt-image-2',
    category: 'image',
    inputTypes: ['text'],
    aspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16'],
    resolutions: ['low', 'medium', 'high', 'auto'],
    defaultAspectRatio: '4:3',
    defaultResolution: 'high',
    description: 'OpenAI\'s top image model — extreme detail, fine typography'
  },

  {
    id: 'flux-2-pro',
    name: 'FLUX.2 [pro]',
    falModel: 'fal-ai/flux-2-pro',
    category: 'image',
    inputTypes: ['text'],
    aspectRatios: ['21:9', '16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16'],
    defaultAspectRatio: '16:9',
    description: 'Black Forest Labs FLUX.2 — 4MP output, character consistency'
  },

  {
    id: 'ideogram-v4',
    name: 'Ideogram v4',
    falModel: 'ideogram/v4',
    category: 'image',
    inputTypes: ['text'],
    aspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16'],
    resolutions: ['TURBO', 'BALANCED', 'QUALITY'],
    defaultAspectRatio: '1:1',
    defaultResolution: 'BALANCED',
    description: 'Best-in-class for text-heavy images — logos, posters, signage'
  },

  // ===== VIDEO MODELS =====
  
  {
    id: 'seedance-1.5',
    name: 'Seedance 1.5',
    falModel: 'fal-ai/bytedance/seedance/v1.5/pro/text-to-video',
    editModel: 'fal-ai/bytedance/seedance/v1.5/pro/image-to-video',
    category: 'video',
    inputTypes: ['text', 'image'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    durations: ['4s', '5s', '6s', '7s', '8s', '9s', '10s', '11s', '12s'],
    resolutions: ['480p', '720p', '1080p'],
    supportsAudio: false,
    defaultAspectRatio: '16:9',
    defaultDuration: '5s',
    defaultResolution: '720p',
    description: 'ByteDance cinematic video, 4-12s'
  },
  
  {
    id: 'seedance-2.0',
    name: 'Seedance 2.0',
    falModel: 'bytedance/seedance-2.0/text-to-video',
    editModel: 'bytedance/seedance-2.0/image-to-video',
    referenceModel: 'bytedance/seedance-2.0/reference-to-video',
    referenceParam: 'image_urls',
    referenceCite: '@Image',
    category: 'video',
    inputTypes: ['text', 'image'],
    aspectRatios: ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    durations: ['auto', '4s', '5s', '6s', '7s', '8s', '9s', '10s', '11s', '12s', '13s', '14s', '15s'],
    resolutions: ['480p', '720p', '1080p'],
    supportsAudio: true,  // Native audio support!
    defaultAspectRatio: '16:9',
    defaultDuration: '5s',
    defaultResolution: '720p',
    description: 'Native audio, multi-shot editing, 4-15s'
  },
  
  {
    id: 'kling-1.0',
    name: 'Kling 1.0',
    falModel: 'fal-ai/kling-video/v1/standard/text-to-video',
    editModel: 'fal-ai/kling-video/v1/standard/image-to-video',
    category: 'video',
    inputTypes: ['text', 'image'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    durations: ['5s', '10s'],
    supportsAudio: false,
    defaultAspectRatio: '16:9',
    defaultDuration: '5s',
    description: 'Kuaishou original video model'
  },

  {
    id: 'kling-1.5',
    name: 'Kling 1.5',
    falModel: 'fal-ai/kling-video/v1.5/pro/text-to-video',
    editModel: 'fal-ai/kling-video/v1.5/pro/image-to-video',
    category: 'video',
    inputTypes: ['text', 'image'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    durations: ['5s', '10s'],
    supportsAudio: false,
    defaultAspectRatio: '16:9',
    defaultDuration: '5s',
    description: 'Improved motion and quality'
  },

  {
    id: 'kling-1.6',
    name: 'Kling 1.6',
    falModel: 'fal-ai/kling-video/v1.6/standard/text-to-video',
    editModel: 'fal-ai/kling-video/v1.6/standard/image-to-video',
    referenceModel: 'fal-ai/kling-video/v1.6/pro/elements',
    referenceParam: 'input_image_urls',
    referenceCite: '@Element',
    category: 'video',
    inputTypes: ['text', 'image'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    durations: ['5s', '10s'],
    supportsAudio: false,
    defaultAspectRatio: '16:9',
    defaultDuration: '5s',
    description: 'Enhanced standard quality'
  },

  {
    id: 'kling-2.6',
    name: 'Kling 2.6 Pro',
    // Image-to-video only (no text-to-video variant). The "pro" tier is
    // the only one documented for v2.6 on fal as of June 2026.
    falModel: 'fal-ai/kling-video/v2.6/pro/image-to-video',
    editModel: 'fal-ai/kling-video/v2.6/pro/image-to-video',
    imageParam: 'start_image_url',
    category: 'video',
    inputTypes: ['text', 'image'],
    aspectRatios: [],          // Inherits from input image.
    durations: ['5s', '10s'],  // String enum on fal side ("5"/"10").
    supportsAudio: true,       // Native audio + voice control. Default ON server-side.
    defaultAspectRatio: '16:9',
    defaultDuration: '5s',
    description: 'Cinematic visuals, fluid motion, native audio + voice control'
  },

  {
    id: 'kling-3.0-standard',
    name: 'Kling 3.0',
    falModel: 'fal-ai/kling-video/v3/standard/text-to-video',
    editModel: 'fal-ai/kling-video/v3/standard/image-to-video',
    imageParam: 'start_image_url',
    referenceParam: 'elements',
    referenceCite: '@Element',
    category: 'video',
    inputTypes: ['text', 'image'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    durations: ['3s', '4s', '5s', '6s', '7s', '8s', '9s', '10s', '11s', '12s', '13s', '14s', '15s'],
    supportsAudio: true,
    defaultAspectRatio: '16:9',
    defaultDuration: '5s',
    description: 'Top-tier cinematic with native audio, multi-shot'
  },

  {
    id: 'kling-3.0-pro',
    name: 'Kling 3.0 Pro',
    falModel: 'fal-ai/kling-video/v3/pro/text-to-video',
    editModel: 'fal-ai/kling-video/v3/pro/image-to-video',
    imageParam: 'start_image_url',
    referenceParam: 'elements',
    referenceCite: '@Element',
    category: 'video',
    inputTypes: ['text', 'image'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    durations: ['3s', '4s', '5s', '6s', '7s', '8s', '9s', '10s', '11s', '12s', '13s', '14s', '15s'],
    supportsAudio: true,
    defaultAspectRatio: '16:9',
    defaultDuration: '5s',
    description: 'Enhanced pro version with multi-shot and element support'
  },

  {
    id: 'kling-3.0-4k',
    name: 'Kling 3.0 4K',
    falModel: 'fal-ai/kling-video/v3/4k/text-to-video',
    editModel: 'fal-ai/kling-video/v3/4k/image-to-video',
    imageParam: 'start_image_url',
    category: 'video',
    inputTypes: ['text', 'image'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    durations: ['3s', '4s', '5s', '6s', '7s', '8s', '9s', '10s', '11s', '12s', '13s', '14s', '15s'],
    resolutions: ['4K'],
    supportsAudio: true,
    defaultAspectRatio: '16:9',
    defaultDuration: '5s',
    defaultResolution: '4K',
    description: 'Native 4K resolution, top-tier quality'
  },

  // Kling o1 — FIRST-FRAME-LAST-FRAME video model. There's no
  // text-to-video or reference-to-video endpoint; the ONLY working
  // path is image-to-video. Wire a start image into image-in (required),
  // optionally wire an end image into end-frame-in, type a prompt
  // describing the transition, submit.
  //
  // The prompt can use `@Image1` to reference the start frame and
  // `@Image2` for the end frame, but most prompts just describe the
  // transition naturally — fal handles both forms.
  //
  // Duration is a STRING enum ("3" through "10"), unlike the integer
  // duration Kling 1.x/3.x use; buildModelInput's kling-o1 branch
  // sends the string form.
  {
    id: 'kling-o1-video',
    name: 'Kling o1',
    // Same endpoint for both falModel and editModel — there's no
    // text-only variant. Users who skip the start frame get a fal-side
    // "image required" error surfaced in the jobs panel.
    falModel: 'fal-ai/kling-video/o1/image-to-video',
    editModel: 'fal-ai/kling-video/o1/image-to-video',
    imageParam: 'start_image_url',
    category: 'video',
    inputTypes: ['text', 'image'],
    aspectRatios: [],  // Inherits from input image (300px min, 0.4:1 to 2.5:1)
    durations: ['3s', '4s', '5s', '6s', '7s', '8s', '9s', '10s'],
    supportsAudio: false,
    defaultAspectRatio: '16:9',
    defaultDuration: '5s',
    description: 'First-frame → last-frame interpolation with prompted transition'
  },

  {
    id: 'minimax-hailuo',
    name: 'MiniMax Hailuo',
    falModel: 'fal-ai/minimax/video-01',
    editModel: 'fal-ai/minimax/video-01/image-to-video',
    category: 'video',
    inputTypes: ['text', 'image'],
    aspectRatios: [],  // No aspect ratio control
    durations: ['6s'],  // Fixed duration
    supportsAudio: false,
    defaultAspectRatio: '16:9',
    defaultDuration: '6s',
    description: 'MiniMax Hailuo AI video, fixed 6s'
  },
  
  {
    id: 'minimax-hailuo-2.3',
    name: 'MiniMax Hailuo 2.3',
    falModel: 'fal-ai/minimax/hailuo-2.3/standard/text-to-video',
    editModel: 'fal-ai/minimax/hailuo-2.3/standard/image-to-video',
    category: 'video',
    inputTypes: ['text', 'image'],
    aspectRatios: [],  // No aspect ratio control
    durations: ['6s', '10s'],
    supportsAudio: false,
    defaultAspectRatio: '16:9',
    defaultDuration: '6s',
    description: 'Enhanced MiniMax, 768p fixed resolution'
  },
  
  {
    id: 'luma-ray2',
    name: 'Luma Ray2',
    falModel: 'fal-ai/luma-dream-machine/ray-2',
    editModel: 'fal-ai/luma-dream-machine/ray-2/image-to-video',
    category: 'video',
    inputTypes: ['text', 'image'],
    aspectRatios: ['16:9', '9:16', '4:3', '3:4', '21:9', '9:21'],
    durations: ['5s', '9s'],
    resolutions: ['540p', '720p', '1080p'],
    supportsAudio: false,
    supportsLoop: true,  // loop parameter
    defaultAspectRatio: '16:9',
    defaultDuration: '5s',
    defaultResolution: '720p',
    description: 'Realistic video with loop support'
  },

  // ===== 2026 VIDEO MODELS =====
  // Veo 3.1 is the current top tier (native audio, true 4K); Fast
  // variant cuts cost in half. Happy Horse is Alibaba's Wan-family
  // model with multilingual lip-sync. LTX-Video 13b is the strongest
  // open-source video option. PixVerse V6 leads stylised/anime output.

  {
    id: 'veo-3.1',
    name: 'Veo 3.1',
    falModel: 'fal-ai/veo3.1',
    editModel: 'fal-ai/veo3.1/image-to-video',
    referenceModel: 'fal-ai/veo3.1/reference-to-video',
    referenceParam: 'image_urls',
    category: 'video',
    inputTypes: ['text', 'image'],
    aspectRatios: ['16:9', '9:16'],
    durations: ['4s', '5s', '6s', '7s', '8s'],
    resolutions: ['720p', '1080p', '4K'],
    supportsAudio: true,
    defaultAspectRatio: '16:9',
    defaultDuration: '8s',
    defaultResolution: '720p',
    description: 'Google\'s top video model — true 4K, native synced audio'
  },

  {
    id: 'veo-3.1-fast',
    name: 'Veo 3.1 Fast',
    falModel: 'fal-ai/veo3.1/fast',
    editModel: 'fal-ai/veo3.1/fast/image-to-video',
    category: 'video',
    inputTypes: ['text', 'image'],
    aspectRatios: ['16:9', '9:16'],
    durations: ['4s', '5s', '6s', '7s', '8s'],
    resolutions: ['720p', '1080p', '4K'],
    supportsAudio: true,
    defaultAspectRatio: '16:9',
    defaultDuration: '8s',
    defaultResolution: '720p',
    description: 'Veo 3.1 Fast — half the cost, same model family'
  },

  {
    id: 'happy-horse',
    name: 'Alibaba Happy Horse',
    falModel: 'alibaba/happy-horse/image-to-video',
    editModel: 'alibaba/happy-horse/image-to-video',  // i2v only
    category: 'video',
    inputTypes: ['image'],  // Image required; prompt optional guidance.
    optionalPrompt: true,
    aspectRatios: [],  // Inherits from input image.
    durations: ['3s', '4s', '5s', '6s', '7s', '8s', '9s', '10s', '11s', '12s', '13s', '14s', '15s'],
    resolutions: ['720p', '1080p'],
    supportsAudio: true,  // Has native multilingual lip-sync.
    defaultAspectRatio: '16:9',
    defaultDuration: '5s',
    defaultResolution: '1080p',
    description: 'Alibaba Wan-family — 1080p with multilingual lip-sync'
  },

  {
    id: 'ltx-video-13b',
    name: 'LTX-Video 13b',
    falModel: 'fal-ai/ltx-video-13b-distilled/image-to-video',
    editModel: 'fal-ai/ltx-video-13b-distilled/image-to-video',  // i2v only on this distilled variant
    category: 'video',
    inputTypes: ['text', 'image'],
    aspectRatios: ['9:16', '1:1', '16:9'],
    durations: ['5s'],  // Set by num_frames (121 @ 24fps); fixed for simplicity.
    resolutions: ['480p', '720p'],
    supportsAudio: false,
    defaultAspectRatio: '16:9',
    defaultDuration: '5s',
    defaultResolution: '720p',
    description: 'Lightricks LTX-Video — strongest open-source video model'
  },

  {
    id: 'pixverse-v6',
    name: 'PixVerse V6',
    falModel: 'fal-ai/pixverse/v6/image-to-video',
    editModel: 'fal-ai/pixverse/v6/image-to-video',
    category: 'video',
    inputTypes: ['text', 'image'],
    aspectRatios: [],  // Inherits from input image.
    durations: ['3s', '4s', '5s', '6s', '7s', '8s'],
    resolutions: ['360p', '540p', '720p', '1080p'],
    supportsAudio: true,
    defaultAspectRatio: '16:9',
    defaultDuration: '5s',
    defaultResolution: '720p',
    description: 'PixVerse V6 — stylised + anime leader, lifelike physics'
  },

  // ===== UPSCALERS =====
  // Wire your low-res clip into the video-in handle on the generator
  // node, pick this model, hit Generate. Output matches the input's
  // duration and aspect ratio — only the resolution changes.
  //
  // Both Standard and Creative modes hit the SAME fal endpoint
  // (fal-ai/topaz/upscale/video). The difference is the `model`
  // parameter in the body:
  //   - Standard → "Proteus" (Topaz's traditional upscaler — fast,
  //     accurate, best for clean source footage).
  //   - Creative → "Starlight HQ" (diffusion-based generative
  //     enhancement — slower but much better at restoring detail in
  //     low-quality source).
  // No prompt is sent in either mode — Topaz's API doesn't take one.
  {
    id: 'topaz-video-upscale',
    name: 'Topaz Video Upscale',
    falModel: 'fal-ai/topaz/upscale/video',  // ONE endpoint; mode picks the model param
    category: 'video',
    inputTypes: ['video'],          // No prompt — Topaz doesn't accept one.
    aspectRatios: [],               // Output inherits from input.
    durations: [],                  // Output inherits from input.
    resolutions: ['2x', '4x'],      // Reused as the upscale factor selector.
    supportsAudio: false,
    defaultAspectRatio: '16:9',
    defaultResolution: '2x',
    description: 'Upscale 2x or 4x. Standard = Proteus model (fast). Creative = Starlight HQ (diffusion-based, better restoration).'
  },

  // ----- IMAGE UPSCALERS -----
  // Used inside the Image Generator node: wire an image into image-in, pick the
  // upscaler, set 2x/4x, hit Generate. No prompt needed (optionalPrompt) — the
  // submit routes to editModel (same endpoint here) with the wired image_url.
  {
    id: 'topaz-image-upscale',
    name: 'Topaz Image Upscale',
    falModel: 'fal-ai/topaz/upscale/image',
    editModel: 'fal-ai/topaz/upscale/image',
    imageParam: 'image_url',
    category: 'image',
    inputTypes: ['image'],
    aspectRatios: [],
    resolutions: ['2x', '4x'],
    optionalPrompt: true,
    defaultAspectRatio: '1:1',
    defaultResolution: '2x',
    description: 'Topaz photo upscaler (Standard V2 model). Clean, accurate enlargement — the workhorse for stills.'
  },
  {
    id: 'clarity-image-upscale',
    name: 'Clarity Upscale',
    falModel: 'fal-ai/clarity-upscaler',
    editModel: 'fal-ai/clarity-upscaler',
    imageParam: 'image_url',
    category: 'image',
    inputTypes: ['image', 'text'],
    aspectRatios: [],
    resolutions: ['2x', '4x'],
    optionalPrompt: true,
    defaultAspectRatio: '1:1',
    defaultResolution: '2x',
    description: 'Detail-restoring creative upscaler. Optional prompt nudges what detail it invents — great for soft / low-quality source.'
  },
  {
    id: 'esrgan-image-upscale',
    name: 'ESRGAN Upscale',
    falModel: 'fal-ai/esrgan',
    editModel: 'fal-ai/esrgan',
    imageParam: 'image_url',
    category: 'image',
    inputTypes: ['image'],
    aspectRatios: [],
    resolutions: ['2x', '4x'],
    optionalPrompt: true,
    defaultAspectRatio: '1:1',
    defaultResolution: '2x',
    description: 'Fast, cheap classic upscaler (Real-ESRGAN). Best on already-clean source where you just need more pixels.'
  },
]

// Helper functions
export function getModelById(id: string): ModelConfig | undefined {
  return FAL_MODELS.find(m => m.id === id)
}

export function getModelsByCategory(category: ModelCategory): ModelConfig[] {
  return FAL_MODELS.filter(m => m.category === category)
}

export function getImageModels(): ModelConfig[] {
  return getModelsByCategory('image')
}

export function getVideoModels(): ModelConfig[] {
  return getModelsByCategory('video')
}

// Build input params based on model config - handles model-specific API differences
export function buildModelInput(
  model: ModelConfig,
  prompt: string,
  options: {
    aspectRatio?: string
    duration?: string
    resolution?: string
    enableAudio?: boolean
    enableLoop?: boolean
    imageUrl?: string
    endImageUrl?: string
    referenceImageUrls?: string[]
    // Grouped reference images — preferred over the flat
    // referenceImageUrls because it preserves per-subject boundaries so
    // element-based models (Kling v3) can build one element per group.
    // If both are supplied, groups win.
    referenceGroups?: { urls: string[] }[]
    seed?: number
    // Topaz upscaler mode — picks which underlying Topaz model variant
    // to send. Doesn't affect any other model.
    upscaleMode?: 'standard' | 'creative'
    // Kling 2.6 voice IDs — comma-separated string of fal-issued voice
    // IDs from the create-voice endpoint. Server splits into array;
    // max 2 used by fal even if more supplied.
    voiceIds?: string
  } = {}
): Record<string, any> {
  const input: Record<string, any> = {}
  // Derive a flat URL list whichever shape the caller used.
  const folderRefsFlat: string[] = options.referenceGroups
    ? options.referenceGroups.flatMap((g) => g.urls)
    : options.referenceImageUrls || []

  // Attach a reference image using the field name(s) the endpoint expects:
  //  - image_urls (array): Nano Banana / Kling o1 image. Folder-mention refs
  //    merge into the same array — for these models every URL is a peer
  //    reference, so a connected image + N mentioned-folder photos all go in.
  //  - video models: set BOTH image_url AND start_image_url. Kling endpoints
  //    require start_image_url (first frame); others use image_url. fal
  //    ignores unknown fields, so sending both is safe + covers every video
  //    endpoint. Folder refs ride separately via referenceParam (handled
  //    below) since video models distinguish first-frame from subject refs.
  //  - image_url (singular, e.g. FLUX image-to-image): falls back to the
  //    first folder-mention ref when no connected image is provided.
  if (model.inputTypes.includes('image')) {
    const primary = options.imageUrl
    const folderRefs = folderRefsFlat

    if (model.imageParam === 'image_urls') {
      const all = primary ? [primary, ...folderRefs] : folderRefs
      if (all.length > 0) input.image_urls = all
    } else if (model.category === 'video') {
      if (primary) {
        input.image_url = primary
        input.start_image_url = primary
      }
      // folderRefs handled below via model.referenceParam
    } else {
      // Singular image_url (FLUX i2i etc.) — only one slot, prefer the
      // explicit connected image but fall back to the first folder ref.
      const pick = primary || folderRefs[0]
      if (pick) input.image_url = pick
    }

    // FLUX image-to-image strength: how much to change the input. fal's
    // default (0.95) nearly ignores the reference; 0.6 keeps it clearly visible.
    if (model.id === 'flux-dev' && (primary || folderRefs.length > 0)) {
      input.strength = 0.6
    }
  }

  // End/last frame (video image-to-video only). Kling v1.x calls it
  // tail_image_url; everything else uses end_image_url. Same endpoint as the
  // first frame, so this never changes which endpoint we submit to.
  if (options.endImageUrl && model.category === 'video') {
    const endParam = ['kling-1.0', 'kling-1.5', 'kling-1.6'].includes(model.id)
      ? 'tail_image_url'
      : 'end_image_url'
    input[endParam] = options.endImageUrl
  }

  // Reference images (subject/style). Shape depends on the model:
  //  - elements: [{frontal_image_url, reference_image_urls}, …] one entry
  //    per subject (Kling v3). The prompt cites @Element{N} which binds
  //    to the N-th element.
  //  - subject_reference_image_url: single string (MiniMax)
  //  - image_urls / input_image_urls: plain array (Seedance 2.0, Kling
  //    o1/1.6). The prompt cites @Image{N} which binds to the N-th URL.
  // The prompt is rewritten on the client (lib/mention-prompt.ts) so the
  // citation indices already match the order of refs/elements we build.
  if (folderRefsFlat.length && model.referenceParam) {
    if (model.referenceParam === 'elements') {
      // Build one element per group. With no per-group structure we fall
      // back to one big element so refs are at least attached.
      const groups = options.referenceGroups && options.referenceGroups.length
        ? options.referenceGroups
        : [{ urls: folderRefsFlat }]
      const elements = groups
        .filter((g) => g.urls.length > 0)
        .map((g) => ({
          frontal_image_url: g.urls[0],
          // Kling v3's schema demands reference_image_urls be a non-empty
          // array. If the user only put one photo in this folder, reuse
          // the same URL so the request is well-formed — the model just
          // gets one image's worth of info, which is the same as having
          // a single reference anyway.
          reference_image_urls:
            g.urls.length > 1 ? g.urls.slice(1) : [g.urls[0]],
        }))
      if (elements.length > 0) input.elements = elements
    } else if (model.referenceParam === 'subject_reference_image_url') {
      input.subject_reference_image_url = folderRefsFlat[0]
    } else {
      input[model.referenceParam] = folderRefsFlat
    }
  }

  // IMAGE UPSCALERS — the wired image is already on input.image_url (set by the
  // central image-attach above). Each just adds its factor/model params; no
  // prompt is sent except Clarity, which takes an optional guidance prompt.
  if (model.id === 'topaz-image-upscale') {
    input.upscale_factor = options.resolution === '4x' ? 4 : 2
    input.model = 'Standard V2'
    input.output_format = 'jpeg'
    return input
  }
  if (model.id === 'clarity-image-upscale') {
    input.upscale_factor = options.resolution === '4x' ? 4 : 2
    if (prompt && prompt.trim()) input.prompt = prompt
    return input
  }
  if (model.id === 'esrgan-image-upscale') {
    input.scale = options.resolution === '4x' ? 4 : 2
    input.model = 'RealESRGAN_x4plus'
    return input
  }

  // FLUX models - image_size must be a {width,height} object (NOT a "WxH"
  // string, which fal rejects with a 422 validation error).
  if (model.id.includes('flux')) {
    input.prompt = prompt
    // image_size only applies to text-to-image; for image-to-image the output
    // follows the input image, and fal ignores image_size anyway.
    if (!options.imageUrl) {
      const aspectRatio = options.aspectRatio || model.defaultAspectRatio
      const sizeMap: Record<string, { width: number; height: number }> = {
        '21:9': { width: 1856, height: 768 },
        '16:9': { width: 1536, height: 768 },
        '4:3': { width: 1408, height: 1056 },
        '3:2': { width: 1344, height: 896 },
        '1:1': { width: 1024, height: 1024 },
        '2:3': { width: 896, height: 1344 },
        '3:4': { width: 1056, height: 1408 },
        '9:16': { width: 768, height: 1536 },
      }
      input.image_size = sizeMap[aspectRatio] || { width: 1024, height: 1024 }
    }
    if (options.seed !== undefined) input.seed = options.seed
    return input
  }

  // NANO BANANA models
  if (model.id.includes('nano-banana')) {
    // prompt is always a plain string. The reference image (image_urls) is
    // attached centrally above and routed to the /edit endpoint in submit.
    input.prompt = prompt
    // Use aspect_ratio for nano banana
    if (options.aspectRatio && model.aspectRatios.includes(options.aspectRatio)) {
      input.aspect_ratio = options.aspectRatio
    } else {
      input.aspect_ratio = model.defaultAspectRatio
    }
    // Resolution parameter
    if (model.resolutions) {
      if (options.resolution && model.resolutions.includes(options.resolution)) {
        input.resolution = options.resolution
      } else if (model.defaultResolution) {
        input.resolution = model.defaultResolution
      }
    }
    if (options.seed !== undefined) input.seed = options.seed
    return input
  }

  // KLING IMAGE (o1) model
  if (model.id === 'kling-o1') {
    input.prompt = prompt
    if (options.aspectRatio && model.aspectRatios.includes(options.aspectRatio)) {
      input.aspect_ratio = options.aspectRatio
    } else {
      input.aspect_ratio = model.defaultAspectRatio
    }
    if (model.resolutions && options.resolution && model.resolutions.includes(options.resolution)) {
      input.resolution = options.resolution
    } else if (model.defaultResolution) {
      input.resolution = model.defaultResolution
    }
    return input
  }

  // SEEDANCE 1.5 model
  if (model.id === 'seedance-1.5') {
    input.prompt = prompt
    if (options.aspectRatio && model.aspectRatios.includes(options.aspectRatio)) {
      input.aspect_ratio = options.aspectRatio
    } else {
      input.aspect_ratio = model.defaultAspectRatio
    }
    if (options.duration && model.durations && model.durations.includes(options.duration)) {
      input.duration = parseInt(options.duration) // Convert "5s" to 5
    } else if (model.defaultDuration) {
      input.duration = parseInt(model.defaultDuration)
    }
    if (model.resolutions && options.resolution && model.resolutions.includes(options.resolution)) {
      input.resolution = options.resolution
    } else if (model.defaultResolution) {
      input.resolution = model.defaultResolution
    }
    return input
  }

  // SEEDANCE 2.0 model
  if (model.id === 'seedance-2.0') {
    input.prompt = prompt
    // aspect_ratio can be "auto" or specific ratio
    if (options.aspectRatio && model.aspectRatios.includes(options.aspectRatio)) {
      input.aspect_ratio = options.aspectRatio
    } else {
      input.aspect_ratio = model.defaultAspectRatio
    }
    // duration can be "auto" or numeric
    if (options.duration && model.durations && model.durations.includes(options.duration)) {
      input.duration = options.duration === 'auto' ? 'auto' : parseInt(options.duration)
    } else if (model.defaultDuration) {
      input.duration = model.defaultDuration === 'auto' ? 'auto' : parseInt(model.defaultDuration)
    }
    if (model.resolutions && options.resolution && model.resolutions.includes(options.resolution)) {
      input.resolution = options.resolution
    } else if (model.defaultResolution) {
      input.resolution = model.defaultResolution
    }
    // Audio generation
    if (options.enableAudio) {
      input.generate_audio = true
    }
    return input
  }

  // KLING o1 — has its own schema: prompt + start_image_url +
  // optional end_image_url + duration STRING enum. start_image_url
  // and end_image_url are attached by submit/route.ts. No aspect
  // ratio (inherits from input), no resolution, no audio.
  if (model.id === 'kling-o1-video') {
    input.prompt = prompt
    if (options.duration && model.durations?.includes(options.duration)) {
      // fal expects the duration as a string ("5"), not an integer (5).
      input.duration = options.duration.replace(/s$/, '')
    } else {
      input.duration = (model.defaultDuration || '5s').replace(/s$/, '')
    }
    return input
  }

  // KLING 2.6 PRO — image-to-video with native audio + voice control.
  // Duration is a STRING enum (like Kling o1), not an integer. fal's
  // server-side default for generate_audio is `true`; we still send
  // the user's toggle state explicitly so toggling off actually saves
  // them the audio-tier cost (~2x the base rate).
  if (model.id === 'kling-2.6') {
    input.prompt = prompt
    if (options.duration && model.durations?.includes(options.duration)) {
      input.duration = options.duration.replace(/s$/, '')  // "5s" → "5"
    } else {
      input.duration = (model.defaultDuration || '5s').replace(/s$/, '')
    }
    // Always send the boolean — defaulting to fal's `true` would silently
    // bill the user 2x for a setting they couldn't see.
    input.generate_audio = !!options.enableAudio
    // Voice IDs: split comma-separated input, trim, dedupe, cap at 2 per
    // fal's documented max. Only sent when the user supplied at least one.
    if (options.voiceIds && options.voiceIds.trim()) {
      const ids = Array.from(
        new Set(
          options.voiceIds
            .split(',')
            .map(s => s.trim())
            .filter(Boolean),
        ),
      ).slice(0, 2)
      if (ids.length > 0) input.voice_ids = ids
    }
    return input
  }

  // KLING VIDEO models (1.0, 1.5, 1.6, 3.0, 3.0 Pro, 3.0 4K)
  if (model.id.includes('kling')) {
    input.prompt = prompt
    if (options.aspectRatio && model.aspectRatios.includes(options.aspectRatio)) {
      input.aspect_ratio = options.aspectRatio
    } else {
      input.aspect_ratio = model.defaultAspectRatio
    }
    // Duration as integer in seconds
    if (options.duration && model.durations && model.durations.includes(options.duration)) {
      input.duration = parseInt(options.duration)
    } else if (model.defaultDuration) {
      input.duration = parseInt(model.defaultDuration)
    }
    // Resolution for 3.0 4K variant only
    if (model.id === 'kling-3.0-4k' && model.resolutions) {
      input.resolution = '4K'
    }
    // Audio for Kling 3.0/Pro and 1.6, o1
    if (model.supportsAudio && options.enableAudio) {
      input.generate_audio = true
    }
    return input
  }

  // LUMA RAY2 model
  if (model.id === 'luma-ray2') {
    input.prompt = prompt
    // aspect_ratio parameter
    if (options.aspectRatio && model.aspectRatios.includes(options.aspectRatio)) {
      input.aspect_ratio = options.aspectRatio
    } else {
      input.aspect_ratio = model.defaultAspectRatio
    }
    // duration as seconds
    if (options.duration && model.durations && model.durations.includes(options.duration)) {
      input.duration = parseInt(options.duration)
    } else if (model.defaultDuration) {
      input.duration = parseInt(model.defaultDuration)
    }
    // resolution parameter
    if (model.resolutions && options.resolution && model.resolutions.includes(options.resolution)) {
      input.resolution = options.resolution
    } else if (model.defaultResolution) {
      input.resolution = model.defaultResolution
    }
    // loop parameter
    if (options.enableLoop) {
      input.loop = true
    }
    return input
  }

  // MINIMAX HAILUO models - minimal params
  if (model.id === 'minimax-hailuo') {
    input.prompt = prompt
    // No aspect_ratio, duration, or resolution params - fixed outputs
    return input
  }

  if (model.id === 'minimax-hailuo-2.3') {
    input.prompt = prompt
    // Only duration parameter
    if (options.duration && model.durations && model.durations.includes(options.duration)) {
      input.duration = options.duration === '6s' ? 6 : 10
    } else {
      input.duration = 6
    }
    // No aspect_ratio or resolution control - fixed 768p output
    return input
  }

  // GPT IMAGE 2 / FLUX.2 [pro] / IDEOGRAM v4 — three new image models
  // all use a shared `image_size` field that accepts {width, height}.
  // Aspect-ratio dropdown values map to fixed pixel sizes; we always
  // send the object form because it's accepted by all three.
  if (
    model.id === 'gpt-image-2' ||
    model.id === 'flux-2-pro' ||
    model.id === 'ideogram-v4'
  ) {
    input.prompt = prompt
    const ratio = options.aspectRatio || model.defaultAspectRatio
    const sizeMap: Record<string, { width: number; height: number }> = {
      '21:9':  { width: 1856, height: 768 },
      '16:9':  { width: 1536, height: 768 },
      '4:3':   { width: 1408, height: 1056 },
      '3:2':   { width: 1344, height: 896 },
      '1:1':   { width: 1024, height: 1024 },
      '2:3':   { width: 896,  height: 1344 },
      '3:4':   { width: 1056, height: 1408 },
      '9:16':  { width: 768,  height: 1536 },
    }
    input.image_size = sizeMap[ratio] || { width: 1024, height: 1024 }

    // Per-model extras:
    if (model.id === 'gpt-image-2') {
      // resolution selector doubles as the quality picker.
      input.quality = options.resolution || model.defaultResolution || 'high'
      if (options.seed !== undefined) input.seed = options.seed
    }
    if (model.id === 'ideogram-v4') {
      // resolution selector doubles as the rendering_speed picker.
      input.rendering_speed = options.resolution || model.defaultResolution || 'BALANCED'
    }
    if (model.id === 'flux-2-pro') {
      if (options.seed !== undefined) input.seed = options.seed
    }
    return input
  }

  // VEO 3.1 / VEO 3.1 FAST — same input schema, different endpoint.
  // Native audio toggle is `audio` (not generate_audio). Resolution
  // includes true 4K. Duration capped at 8s per fal's docs.
  if (model.id === 'veo-3.1' || model.id === 'veo-3.1-fast') {
    input.prompt = prompt
    if (options.aspectRatio && model.aspectRatios.includes(options.aspectRatio)) {
      input.aspect_ratio = options.aspectRatio
    } else {
      input.aspect_ratio = model.defaultAspectRatio
    }
    if (options.duration && model.durations?.includes(options.duration)) {
      input.duration = parseInt(options.duration)
    } else if (model.defaultDuration) {
      input.duration = parseInt(model.defaultDuration)
    }
    if (model.resolutions && options.resolution && model.resolutions.includes(options.resolution)) {
      input.resolution = options.resolution
    } else if (model.defaultResolution) {
      input.resolution = model.defaultResolution
    }
    if (options.enableAudio !== undefined) input.audio = options.enableAudio
    return input
  }

  // ALIBABA HAPPY HORSE — image-to-video only. Prompt optional,
  // attached if supplied. Resolution + duration straightforward.
  if (model.id === 'happy-horse') {
    if (prompt && prompt.trim()) input.prompt = prompt
    if (options.duration && model.durations?.includes(options.duration)) {
      input.duration = parseInt(options.duration)
    } else if (model.defaultDuration) {
      input.duration = parseInt(model.defaultDuration)
    }
    if (model.resolutions && options.resolution && model.resolutions.includes(options.resolution)) {
      input.resolution = options.resolution
    } else if (model.defaultResolution) {
      input.resolution = model.defaultResolution
    }
    return input
  }

  // LTX-VIDEO 13B (distilled) — image-to-video only on this variant.
  // Duration is implicit in num_frames; we don't expose it. The
  // distilled model takes resolution + aspect_ratio + num_frames.
  if (model.id === 'ltx-video-13b') {
    input.prompt = prompt
    if (model.resolutions && options.resolution && model.resolutions.includes(options.resolution)) {
      input.resolution = options.resolution
    } else if (model.defaultResolution) {
      input.resolution = model.defaultResolution
    }
    if (options.aspectRatio && model.aspectRatios.includes(options.aspectRatio)) {
      input.aspect_ratio = options.aspectRatio
    } else {
      input.aspect_ratio = model.defaultAspectRatio
    }
    input.num_frames = 121  // ≈ 5 s at 24 fps; fixed for now.
    return input
  }

  // PIXVERSE V6 — image-to-video. Optional audio via generate_audio_switch.
  if (model.id === 'pixverse-v6') {
    input.prompt = prompt
    if (options.duration && model.durations?.includes(options.duration)) {
      input.duration = parseInt(options.duration)
    } else if (model.defaultDuration) {
      input.duration = parseInt(model.defaultDuration)
    }
    if (model.resolutions && options.resolution && model.resolutions.includes(options.resolution)) {
      input.resolution = options.resolution
    } else if (model.defaultResolution) {
      input.resolution = model.defaultResolution
    }
    if (options.enableAudio) input.generate_audio_switch = true
    return input
  }

  // TOPAZ VIDEO UPSCALE — video_url is attached by the submit route
  // from the connected video-in handle. The resolution selector is
  // reused as the upscale-factor picker: "2x" → 2, "4x" → 4.
  //
  // Mode controls the underlying Topaz model variant:
  //   - Standard → "Proteus" (traditional upscaler, fast)
  //   - Creative → "Starlight HQ" (diffusion-based, better restoration)
  // Both go to the same fal endpoint; no prompt is ever sent.
  if (model.id === 'topaz-video-upscale') {
    input.upscale_factor = options.resolution === '4x' ? 4 : 2
    input.model = options.upscaleMode === 'creative' ? 'Starlight HQ' : 'Proteus'
    return input
  }

  // Default fallback (shouldn't reach here)
  input.prompt = prompt
  return input
}
