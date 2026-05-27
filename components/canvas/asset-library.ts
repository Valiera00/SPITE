export type AssetCategory = 'characters' | 'props' | 'locations' | 'general'

export interface Asset {
  id: string
  name: string
  category: AssetCategory
  description?: string
  thumbnail?: string
  tags?: string[]
}
