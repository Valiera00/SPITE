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
  category: ModelCategory
  inputTypes: InputType[]
  aspectRatios: string[]
  durations?: string[]          // Only for video models
  resolutions?: string[]        // Optional resolution control
  supportsAudio?: boolean       // For video models with sound generation
  supportsLoop?: boolean        // For video models with loop option
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
    id: 'kling-3.0-standard',
    name: 'Kling 3.0',
    falModel: 'fal-ai/kling-video/v3/standard/text-to-video',
    editModel: 'fal-ai/kling-video/v3/standard/image-to-video',
    imageParam: 'start_image_url',
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

  {
    id: 'kling-o1-video',
    name: 'Kling o1',
    falModel: 'fal-ai/kling-video/o1/text-to-video',
    editModel: 'fal-ai/kling-video/o1/image-to-video',
    imageParam: 'start_image_url',
    category: 'video',
    inputTypes: ['text', 'image', 'video'],
    aspectRatios: ['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9'],
    durations: ['3s', '4s', '5s', '6s', '7s', '8s', '9s', '10s'],
    supportsAudio: false,
    defaultAspectRatio: '16:9',
    defaultDuration: '5s',
    description: 'Multimodal video engine with element references'
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
    seed?: number
  } = {}
): Record<string, any> {
  const input: Record<string, any> = {}

  // Attach a reference image using the field name(s) the endpoint expects:
  //  - image_urls (array): Nano Banana, Kling o1 image
  //  - video models: set BOTH image_url AND start_image_url. Kling endpoints
  //    require start_image_url (first frame); others use image_url. fal ignores
  //    unknown fields, so sending both is safe + covers every video endpoint.
  //  - image_url: everything else (e.g. FLUX image-to-image)
  if (options.imageUrl && model.inputTypes.includes('image')) {
    if (model.imageParam === 'image_urls') {
      input.image_urls = [options.imageUrl]
    } else if (model.category === 'video') {
      input.image_url = options.imageUrl
      input.start_image_url = options.imageUrl
    } else {
      input.image_url = options.imageUrl
    }
    // FLUX image-to-image strength: how much to change the input. fal's
    // default (0.95) nearly ignores the reference; 0.6 keeps it clearly visible.
    if (model.id === 'flux-dev') {
      input.strength = 0.6
    }
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

  // KLING VIDEO models (1.0, 1.5, 1.6, 3.0, 3.0 Pro, 3.0 4K, o1)
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

  // Default fallback (shouldn't reach here)
  input.prompt = prompt
  return input
}
