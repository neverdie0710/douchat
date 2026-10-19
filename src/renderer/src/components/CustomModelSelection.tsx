import { Check, Cloud, KeyRound } from 'lucide-react'
import { useState } from 'react'
import { t, tr } from '../preferences'
import { PickerPopover } from './PickerPopover'
import type { CustomModelConfig } from '../../../shared/customModels'
import type { ModelOption } from '../../../shared/types'

interface ModelItem { providerId: string; model: string; label: string; detail?: string }

/**
 * Model for an agent on Douchat's built-in harness: a one-line selector that
 * opens two columns, the provider (Douchat Cloud first, then the user's own)
 * and its models. Browsing providers changes nothing; choosing a model does.
 * '@default' follows the user's default custom model; 'douchat-default'
 * follows Douchat Cloud's.
 */
export function CustomModelSelection({ config, cloudModels, providerId, model, disabled, onChange }: {
  config: CustomModelConfig
  cloudModels: ModelOption[]
  providerId: string
  model: string
  disabled?: boolean
  onChange: (providerId: string, model: string) => void
}) {
  const [defaultProviderId, ...parts] = config.defaultModel.split('/')
  const defaultModel = parts.join('/')
  const defaultProvider = config.providers.find(item => item.id === defaultProviderId && item.models.includes(defaultModel))
  // '@default' is listed as its own provider: it follows the default model set in Settings.
  const selectedProvider = providerId
  // The provider whose models are listed; it follows the selection until another is opened.
  const [opened, setOpened] = useState<string>()
  const viewing = opened ?? selectedProvider
  const known = selectedProvider === 'cloud' || selectedProvider === '@default' || config.providers.some(item => item.id === selectedProvider)
  const providers = [
    { id: 'cloud', name: 'Douchat Cloud' },
    ...(config.defaultModel || providerId === '@default' ? [{ id: '@default', name: t('Default model') }] : []),
    ...config.providers.map(item => ({ id: item.id, name: item.name || item.id })),
    ...(!known && selectedProvider ? [{ id: selectedProvider, name: selectedProvider }] : [])
  ]
  const byLabel = (a: ModelItem, b: ModelItem) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base', numeric: true })
  const cloudDefault = cloudModels.find(item => item.model === 'douchat-default') ?? cloudModels[0]
  const modelsOf = (id: string): ModelItem[] => {
    if (id === 'cloud') return [
      { providerId: 'cloud', model: 'douchat-default', label: cloudDefault?.label || cloudDefault?.model || 'Douchat Default', detail: t("Follows Douchat's default") },
      ...cloudModels.filter(item => item.model !== 'douchat-default').map(item => ({ providerId: 'cloud', model: item.model, label: item.label || item.model })).sort(byLabel)
    ]
    if (id === '@default') return defaultProvider
      // No model name here: the agent follows whatever the default becomes, not today's model.
      ? [{ providerId: '@default', model: 'default', label: t('Follow default model'), detail: t('Uses the default model set in Settings, and changes with it') }]
      : []
    const provider = config.providers.find(item => item.id === id)
    if (!provider) return []
    return provider.models.map(item => ({ providerId: id, model: item, label: provider.modelLabels?.[item] || item })).sort(byLabel)
  }
  const isSelected = (item: ModelItem) => item.providerId === providerId && (item.providerId === '@default' || item.model === model)
  const list = modelsOf(viewing)
  const available = providerId === '@default' ? Boolean(defaultProvider) : modelsOf(selectedProvider).some(isSelected)
  const providerName = providers.find(item => item.id === selectedProvider)?.name ?? selectedProvider
  const chosen = modelsOf(selectedProvider).find(isSelected)
  // Like the harness line: the model fills it and its provider sits at the right.
  const trigger = available && chosen
    ? <><span>{chosen.label}</span>{selectedProvider !== '@default' && <small className="agent-select-host">{providerName}</small>}</>
    : <span>{tr('{name} (unavailable)', { name: model || t('Choose a model') })}</span>
  return <div className="field-row custom-model-selection"><span>{t('Model')}</span>
    <PickerPopover label={t('Model')} trigger={trigger} disabled={disabled}>{close => <div className="harness-picker model-picker">
      <div className="harness-places" role="listbox" aria-label={t('Provider')}>
        {providers.map(item => <button type="button" role="option" key={item.id} aria-selected={item.id === viewing} disabled={disabled} className={item.id === viewing ? 'selected' : ''} onClick={() => setOpened(item.id)}>
          {item.id === 'cloud' ? <Cloud size={16} /> : <KeyRound size={16} />}<span>{item.name}</span>
        </button>)}
      </div>
      <div className="harness-agents" role="listbox" aria-label={t('Custom model')}>
        {viewing === selectedProvider && !available && <button type="button" role="option" aria-selected="true" aria-disabled="true" className="selected" disabled>
          <span className="harness-agent-copy"><strong>{tr('{name} (unavailable)', { name: model || t('Choose a model') })}</strong></span>
        </button>}
        {list.map(item => <button type="button" role="option" key={`${item.providerId}/${item.model}`} aria-selected={isSelected(item)} disabled={disabled} className={isSelected(item) ? 'selected' : ''} onClick={() => { onChange(item.providerId, item.model); setOpened(undefined); close() }}>
          <span className="harness-agent-copy"><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</span>{isSelected(item) && <Check size={16} />}
        </button>)}
        {!list.length && viewing !== selectedProvider && <p className="settings-note">{t('This provider has no models yet.')}</p>}
      </div>
    </div>}</PickerPopover>
  </div>
}
