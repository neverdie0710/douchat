import { t, tr } from '../preferences'
import type { CustomModelConfig } from '../../../shared/customModels'
import type { ModelOption } from '../../../shared/types'

export function CustomModelSelection({ config, cloudModels, providerId, model, disabled, onChange }: {
  config: CustomModelConfig
  cloudModels: ModelOption[]
  providerId: string
  model: string
  disabled?: boolean
  onChange: (providerId: string, model: string) => void
}) {
  const cloud = providerId === 'cloud'
  const cloudDefault = cloudModels.find(item => item.model === 'douchat-default') ?? cloudModels[0]
  const [defaultProviderId, ...parts] = config.defaultModel.split('/')
  const defaultAvailable = Boolean(config.providers.find(item => item.id === defaultProviderId)?.models.includes(parts.join('/')))
  const options = cloud
    ? cloudModels.filter(item => item.model !== 'douchat-default').map(item => ({ providerId: 'cloud', model: item.model, label: item.label || item.model }))
    : config.providers.flatMap(provider => provider.models.map(id => ({ providerId: provider.id, model: id, label: provider.id + '/' + id })))
  options.sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base', numeric: true }))
  const isDefault = providerId === '@default' || cloud && model === 'douchat-default'
  const selected = isDefault ? 'default' : JSON.stringify([providerId, model])
  const available = isDefault || options.some(item => item.providerId === providerId && item.model === model)
  return <div className="custom-model-selection">
    <label className="field-row"><span>{t('Model source')}</span>
      <select aria-label={t('Model source')} value={cloud ? 'cloud' : 'custom'} disabled={disabled} onChange={event => {
        onChange(event.target.value === 'cloud' ? 'cloud' : '@default', event.target.value === 'cloud' ? 'douchat-default' : 'default')
      }}><option value="cloud">{t('Douchat Cloud')}</option><option value="custom">{t('Custom Model')}</option></select>
    </label>
    <label className="field-row"><span>{t('Model')}</span>
      <select aria-label={t('Custom model')} value={selected} disabled={disabled} onChange={event => {
        if (event.target.value === 'default') onChange(cloud ? 'cloud' : '@default', cloud ? 'douchat-default' : 'default')
        else {
          const option = options.find(item => JSON.stringify([item.providerId, item.model]) === event.target.value)
          if (option) onChange(option.providerId, option.model)
        }
      }}>
        <option value="default" disabled={!cloud && !defaultAvailable}>{cloud ? cloudDefault?.label || cloudDefault?.model || 'Douchat Default' : t('Default model')}</option>
        {!available && <option value={selected} disabled>{tr('{name} (unavailable)', { name: model || t('Choose a model') })}</option>}
        {options.map(item => <option key={JSON.stringify([item.providerId, item.model])} value={JSON.stringify([item.providerId, item.model])}>{item.label}</option>)}
      </select>
    </label>
  </div>
}
