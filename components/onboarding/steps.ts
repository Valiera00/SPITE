import type { TourSurface } from '@/lib/onboarding'

// One step in a tour. `target` is a `[data-tour="..."]` selector to spotlight;
// omit it (or let it resolve to nothing) and the popover renders centered — used
// for welcome/concept steps and for empty-state fallbacks. `image` points at a
// swappable file under /public/onboarding/ (your screenshots/renders); it hides
// itself gracefully if the file is missing.
export interface TourStep {
  target?: string
  title: string
  body: string
  image?: string
  placement?: 'auto' | 'top' | 'bottom' | 'left' | 'right'
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
      title: 'This is the Canvas',
      body: 'An infinite plane where each node is a piece of your shot. Drag, connect, and generate. Here’s the lay of the land.',
      image: '/onboarding/canvas-welcome.png',
    },
    {
      target: '[data-tour="left-toolbar"]',
      title: 'Your tools',
      body: 'Select, add nodes, cut connections, drop stickers and comments — plus your asset library (Characters, Props, Locations).',
    },
    {
      target: '[data-tour="tool-add"]',
      title: 'Add a node',
      body: 'Add prompts, image/video generators, uploads and more — or just right-click anywhere on the canvas to open the same menu.',
      image: '/onboarding/canvas-add-menu.png',
    },
    {
      title: 'Prompt → generate → result',
      body: 'Connect a prompt (and any references) into a generator, hit Generate, and the result lands right on the node. Tag images to a Character/Prop folder and @mention them in any prompt.',
      image: '/onboarding/canvas-nodes.png',
    },
    {
      target: '[data-tour="scene-timeline"]',
      title: 'Scenes & shots',
      body: 'Organise your work into scenes and shots along the top strip — then Export a storyboard zip, one folder per scene, named by shot order.',
      image: '/onboarding/canvas-export.png',
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
}
