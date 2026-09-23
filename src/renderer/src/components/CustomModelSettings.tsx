import { t, tr } from '../preferences'
import { useEffect, useRef, useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { CUSTOM_MODEL_PRESETS, customEndpoint, type CustomModelConfig, type CustomProviderInput, type CustomProviderView } from '../../../shared/customModels'
import { NativeDialog } from './NativeDialog'
import { messageSendError } from '../messageQueue'

type Draft = CustomProviderInput & { preset: string; hasKey: boolean }
export function CustomModelSettings() {
  const [config, setConfig] = useState<CustomModelConfig>({ providers: [], defaultModel: '' })
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null)
  const generation = useRef(0)
  useEffect(() => {
    let active = true
    window.douchat.getCustomModels().then(value => { if (active) setConfig(value) }).catch(e => { if (active) setError(messageSendError(e)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; generation.current++ }
  }, [])
  function edit(p?: CustomProviderView) {
    generation.current++; setError(''); setResult(null)
    const preset = CUSTOM_MODEL_PRESETS[0]
    setDraft(p ? { ...p, preset: CUSTOM_MODEL_PRESETS.find(x => x.apiBase === p.apiBase)?.id ?? 'custom', apiKey: '' }
      : { ...preset, preset: preset.id, id: preset.id, apiKey: '', hasKey: false, modelLabels: {} })
  }
  function change(patch: Partial<Draft>) { generation.current++; setResult(null); setDraft(previous => previous && { ...previous, ...patch }) }
  function input(): CustomProviderInput {
    const d = draft!
    const models = [...new Set(d.models.map(m => m.trim()).filter(Boolean))]
    return { id: d.id, name: d.name, kind: d.kind, apiBase: d.apiBase, apiKey: d.apiKey || undefined, models, modelLabels: Object.fromEntries(models.map(model => [model, d.modelLabels?.[model]?.trim() || '']).filter(([, label]) => label)) }
  }
  async function persist(providers: CustomProviderInput[], defaultModel: string) {
    setBusy(true); setError('')
    try { setConfig(await window.douchat.saveCustomModels(providers, defaultModel)); setDraft(null) }
    catch (e) { setError(messageSendError(e)) }
    finally { setBusy(false) }
  }
  async function test() {
    const provider = input(); const request = ++generation.current
    setTesting(true); setResult(null)
    try { const value = await window.douchat.testCustomModel({ provider, model: provider.models[0] ?? '' }); if (request === generation.current) setResult(value) }
    catch (e) { if (request === generation.current) setResult({ ok: false, error: messageSendError(e) }) }
    finally { setTesting(false) }
  }
  return <>
    <header className="settings-heading local-proxy-heading"><div><h1>{t("Models")}</h1><p>{t("Connect your model services to use when creating agents. Each provider handles billing.")}</p></div><button className="secondary-button" disabled={loading || busy} onClick={() => edit()}><Plus size={15} />{t("Add provider")}</button></header>
    {loading ? <p role="status">{t("Loading model settings…")}</p> : <>
      {!config.providers.length ? <div className="custom-model-empty"><strong>{t("No providers yet")}</strong><p>{t("Add a provider to create agents with your own models.")}</p><span>{t("Supports OpenAI Chat Completions and Anthropic Messages")}</span></div> : <div className="custom-model-table"><table><thead><tr><th>{t("Provider")}</th><th>{t("API URL")}</th><th>{t("Models")}</th><th>{t("Actions")}</th></tr></thead><tbody>{config.providers.map(p => <tr key={p.id}><td><strong>{p.name}</strong><small>{p.kind === 'anthropic' ? 'Anthropic Messages' : 'OpenAI Chat Completions'}</small></td><td><code>{p.apiBase}</code></td><td>{p.models.length}</td><td><div className="custom-model-actions"><button className="icon-button" aria-label={tr('Edit {name}', { name: p.name })} onClick={() => edit(p)}><Pencil size={16} /></button><button className="icon-button" aria-label={tr('Delete {name}', { name: p.name })} disabled={busy} onClick={() => { if (window.confirm(tr('Remove {name}? Agents using these models will be unable to chat until reconfigured. Chat history will be kept.', { name: p.name }))) void persist(config.providers.filter(provider => provider.id !== p.id), config.defaultModel) }}><Trash2 size={16} /></button></div></td></tr>)}</tbody></table></div>}
    </>}
    {error && !draft && <p className="settings-error" role="alert">{t(error)}</p>}
    {draft && <NativeDialog className="modal-backdrop" onClose={() => { if (!busy && !testing) setDraft(null) }} width={600} height={730}>
      <form className="agent-modal custom-model-form" role="dialog" aria-modal="true" aria-labelledby="custom-model-title" onSubmit={e => { e.preventDefault(); const p = input(); void persist(config.providers.some(x => x.id === p.id) ? config.providers.map(x => x.id === p.id ? p : x) : [...config.providers, p], config.defaultModel || `${p.id}/${p.models[0]}`) }}>
        <h2 id="custom-model-title">{draft.hasKey ? t("Edit provider") : t("Add provider")}</h2>
        <div className="custom-model-fields"><label className="field-row"><span>{t("Provider preset")}</span><select value={draft.preset} disabled={busy} onChange={e => { const p = CUSTOM_MODEL_PRESETS.find(x => x.id === e.target.value); change(p ? { preset: p.id, id: p.id, name: p.name, kind: p.kind, apiBase: p.apiBase, models: [...p.models], modelLabels: {} } : { preset: 'custom', id: '', name: '', apiBase: '', apiKey: '', models: [''], modelLabels: {} }) }}>{CUSTOM_MODEL_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}<option value="custom">{t("Other / Custom")}</option></select></label>
        <label className="field-row"><span>{t("API type")}</span><select value={draft.kind} onChange={e => change({ kind: e.target.value as Draft['kind'] })}><option value="openai">OpenAI Chat Completions</option><option value="anthropic">Anthropic Messages</option></select></label></div>
        <div className="custom-model-fields"><label className="field-row"><span>{t("Identifier")}</span><input required pattern="[a-zA-Z0-9-]{1,80}" value={draft.id} onChange={e => change({ id: e.target.value })} placeholder={t("e.g. openrouter")} /></label><label className="field-row"><span>{t("Display name")}</span><input required value={draft.name} onChange={e => change({ name: e.target.value })} placeholder={t("e.g. OpenRouter")} /></label></div>
        <label className="field-row"><span>{t("API URL")}</span><input required type="url" value={draft.apiBase} onChange={e => change({ apiBase: e.target.value })} placeholder="https://api.example.com/v1" /></label>
        <label className="field-row"><span>{t("API key")}</span><input type="password" autoComplete="new-password" required={!draft.hasKey} value={draft.apiKey} onChange={e => change({ apiKey: e.target.value })} placeholder={draft.hasKey ? t("Leave empty to keep the saved key") : t("Enter API key")} /></label>
        <div className="field-row custom-model-list">
          <span id="custom-model-list-label">{t("Models (ID / display name)")}</span>
          <div className="custom-model-inputs" role="group" aria-labelledby="custom-model-list-label">
            {draft.models.map((model, index) => <div className="custom-model-input-row" key={index}>
              <input aria-label={t("Model ID ") + (index + 1)} value={model} disabled={busy || testing} placeholder={t("Model ID, e.g. org/model")} onChange={e => change({ models: draft.models.map((value, i) => i === index ? e.target.value : value) })} />
              <input aria-label={t("Model display name ") + (index + 1)} value={draft.modelLabels?.[model] || ''} disabled={busy || testing} placeholder={t("Display name (optional)")} onChange={e => change({ modelLabels: { ...draft.modelLabels, [model]: e.target.value } })} />
              <button className="icon-button" type="button" aria-label={t("Remove model ") + (index + 1)} disabled={busy || testing || draft.models.length === 1} onClick={() => change({ models: draft.models.filter((_, i) => i !== index) })}><Trash2 size={16} /></button>
            </div>)}
          </div>
          <button className="custom-model-add" type="button" disabled={busy || testing} onClick={() => change({ models: [...draft.models, ''] })}><Plus size={15} />{t("Add model")}</button>
        </div>
        <div className="custom-model-test-note"><p className="settings-note">{t("The connection test sends a short message to the first model and may incur a small charge.")}</p><p className="settings-note custom-model-endpoint">{t("Test endpoint: ")}{customEndpoint(draft.apiBase, draft.kind)}</p></div>
        {result && <p role="status" className={result.ok ? 'custom-model-success' : 'settings-error'}>{result.ok ? t("Connection successful") : result.error}</p>}
        {error && <p className="settings-error" role="alert">{t(error)}</p>}
        <div className="modal-footer"><button className="secondary-button" type="button" disabled={busy || testing || !draft.models.some(model => model.trim())} onClick={() => void test()}>{testing ? t("Testing…") : t("Test connection")}</button><div className="custom-model-footer-actions"><button className="secondary-button" type="button" disabled={busy || testing} onClick={() => setDraft(null)}>{t("Cancel")}</button><button className="primary-button" disabled={busy || testing || !draft.models.some(model => model.trim())}>{busy ? t("Saving…") : t("Save")}</button></div></div>
      </form>
    </NativeDialog>}
  </>
}
