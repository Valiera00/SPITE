// What Settings → Model providers shows: each family's choice, whether it is
// set up, prices, and where each key comes from. Never includes a secret's
// value: only its source and last four characters.

import { FAMILIES, getChoices, type Family } from './model-routing'
import { estimateGenerationCost } from './fal-cost'
import { getModelById } from './fal-models'
import { describeSetting, isSettingName } from './provider-secrets'

// 1080p price per second on fal and direct, for Settings to compare. Silent
// 1-second render, so it is the plain rate with nothing added.
function perSecond(modelId: string, provider: Parameters<typeof estimateGenerationCost>[1]['provider']) {
  const model = getModelById(modelId)
  const e = estimateGenerationCost(model, { count: 1, durationSeconds: 1, resolution: '1080p', audio: false, provider })
  return e.isKnown && e.provider === (provider || 'fal') ? e.perUnit : null
}

export async function describeProviders() {
  const choices = await getChoices()
  return {
    families: await Promise.all((Object.keys(FAMILIES) as Family[]).map(async (id) => {
      const { label, models, provider } = FAMILIES[id]
      const pricing = await provider.pricingId()
      return {
        id,
        label,
        choice: choices[id],
        provider: provider.label,
        configured: await provider.configured(),
        pricing,
        settings: await Promise.all(provider.envVars.filter(isSettingName).map(describeSetting)),
        prices: models.map((m) => ({
          model: getModelById(m)?.name || m,
          fal: perSecond(m, 'fal'),
          direct: perSecond(m, pricing),
        })),
      }
    })),
  }
}
