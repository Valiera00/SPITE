import type { TourSurface } from '@/lib/onboarding'

// One step in a tour. `target` is a `[data-tour="..."]` selector to spotlight;
// omit it (or let it resolve to nothing) and the popover renders centered — used
// for welcome/concept steps and for empty-state fallbacks. `image`/`video` point
// at swappable files under /public/onboarding/ (your screenshots/renders); they
// hide themselves gracefully if missing. `onEnter`/`onLeave` run side effects
// (e.g. opening the assets panel) as the step is shown / left.
export interface TourStep {
  target?: string
  title: string
  body: string
  image?: string
  video?: string
  placement?: 'auto' | 'top' | 'bottom' | 'left' | 'right'
  onEnter?: () => void
  onLeave?: () => void
}

// Drive the canvas assets panel from the tour (left-toolbar listens for this).
const assets = (mode: 'side' | 'expanded' | 'close') => () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('spite:tour-assets', { detail: mode }))
  }
}

export const TOURS: Record<TourSurface, TourStep[]> = {
  dashboard: [
    {
      title: 'Welcome to SPITE',
      body: 'Your pre-production studio for AI filmmaking. There are two ways to create — let’s take a quick look. (You can skip anytime.)',
      image: '/onboarding/dashboard-welcome.png',
    },
    {
      target: '[data-tour="new-canvas"]',
      title: 'Canvas — the node graph',
      body: 'Start a Canvas to build shots and scenes on an infinite plane: prompts, references, image and video generators, all wired together.',
      image: '/onboarding/canvas-overview.png',
    },
    {
      target: '[data-tour="new-flow"]',
      title: 'Flow — fast & linear',
      body: 'Prefer something simpler? Flow is a conversational prompt→image thread. Same models, works on your phone too.',
      image: '/onboarding/flow-overview.png',
    },
    {
      target: '[data-tour="search"]',
      title: 'Find anything',
      body: 'Search across all your projects by name as your library grows.',
    },
    {
      title: 'You’re set',
      body: 'Create your first project to dive in. You can replay this tour anytime from the “?” in the top bar.',
    },
  ],
  canvas: [
    {
      title: 'Welcome to the Canvas',
      body: 'An infinite plane where every node is a piece of your shot — drag, connect and generate. Here’s how it flows.',
      video: '/onboarding/canvas-working.mp4',
      image: '/onboarding/canvas-welcome.png', // fallback if the video is absent
    },
    {
      target: '[data-tour="left-toolbar"]',
      title: 'Your tools',
      body: 'Select, add nodes, cut connections, drop stickers and comments — all from this strip.',
    },
    {
      target: '[data-tour="tool-add"]',
      title: 'Add a node anywhere',
      body: 'Use this to add a node — or just right-click anywhere on the empty canvas to open the same menu (prompts, image/video generators, uploads and more) right where your cursor is.',
      image: '/onboarding/canvas-add-menu.png',
    },
    {
      target: '[data-tour="assets-panel"]',
      title: 'Your asset library',
      body: 'Characters, Props, Locations and uploads live in this side panel. Tag an image to a folder, then @mention it in any prompt to keep a character consistent.',
      onEnter: assets('side'),
      onLeave: assets('close'),
    },
    {
      target: '[data-tour="assets-expanded"]',
      title: 'Browse it full-screen',
      body: 'Open the library expanded to search, organise into folders, and drag assets straight onto the canvas.',
      onEnter: assets('expanded'),
      onLeave: assets('close'),
    },
    {
      target: '[data-tour="scene-timeline"]',
      title: 'Scenes, shots & pages',
      body: 'Assign a node to a shot from the badge on the node itself — assigned shots always glow yellow so you can spot them at a glance. The strip up here switches between scenes, and you can keep as many pages / scenes / canvases as you need. Export drops a storyboard zip, one folder per scene.',
      image: '/onboarding/canvas-shot.png',
    },
    {
      target: '[data-tour="jobs-toggle"]',
      title: 'Track every generation',
      body: 'The jobs panel shows what’s running and what finished. Your canvas autosaves every few seconds — the save status sits up here too.',
    },
  ],
  flow: [
    {
      title: 'This is Flow',
      body: 'A simple, linear way to generate: describe an image, pick a model, generate. Each result keeps its prompt, model and references.',
      image: '/onboarding/flow-welcome.png',
    },
    {
      target: '[data-tour="compose"]',
      title: 'Describe it here',
      body: 'Type what you want and hit generate. This bar stays with you as the thread grows.',
    },
    {
      target: '[data-tour="model"]',
      title: 'Models & settings',
      body: 'Switch models, set the aspect ratio and resolution (defaults to 2K), and choose how many images per prompt.',
    },
    {
      target: '[data-tour="attach"]',
      title: 'Attach references',
      body: 'Add reference images to steer a generation — character, style, composition. They’re remembered with each result.',
    },
    {
      target: '[data-tour="generate"]',
      title: 'Generate',
      body: 'Results stream in below, newest at the bottom. Tap one to revisit it.',
    },
    {
      target: '[data-tour="result"]',
      title: 'Reuse, copy, save',
      body: 'On any result: Reuse brings its prompt + references back into the composer, Copy also restores model + aspect, and Save downloads it.',
      image: '/onboarding/flow-result.png',
    },
  ],
  settings: [
    {
      title: 'Settings',
      body: 'A quick look at what you can tune here.',
      image: '/onboarding/settings-overview.png',
    },
    {
      target: '[data-tour="settings-apikey"]',
      title: 'Your fal.ai key',
      body: 'SPITE runs on your own fal.ai key — set it in your host’s environment variables. This shows the live connection status.',
    },
    {
      target: '[data-tour="settings-retention"]',
      title: 'Data retention',
      body: 'Nothing is auto-deleted by default. Optionally have old unused results and reference inputs cleaned up after a set number of days.',
    },
    {
      target: '[data-tour="settings-storage"]',
      title: 'Storage',
      body: 'See how much of your Cloudflare R2 free tier you’re using at a glance.',
    },
    {
      target: '[data-tour="settings-recovery"]',
      title: 'Recovery',
      body: 'If a generation gets stuck (a spinner that never ends) or vanishes after a refresh, “Recover stuck generations” pulls any job fal actually finished back into your library — fal keeps results ~24h, and the check is free to run. Recovered assets get a small blue badge in the asset panel so you can tell them apart; “Backfill badges” adds that badge to anything recovered before the badge existed.',
      image: '/onboarding/settings-recovery.png',
    },
  ],
}
