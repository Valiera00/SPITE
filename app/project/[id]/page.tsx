import { CanvasWorkspace } from '@/components/canvas/canvas-workspace'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ProjectPage({ params }: Props) {
  const { id } = await params
  return <CanvasWorkspace projectId={id} />
}
