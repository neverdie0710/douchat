import { t, tr, usePreferences } from '../preferences'
import { useEffect, useState } from 'react'
import { CLOUD_DECISION_PROVIDER_ID, DEFAULT_DECISION_SETTINGS, desktopDecisionSettings, type CloudDecisionModel, type DecisionSettings as Settings } from '../../../shared/groupDecision'
import { messageSendError } from '../messageQueue'

export function DecisionSettings() {
  usePreferences()
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_DECISION_SETTINGS })
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ error?: string; saveError?: string }>()
  const [notice, setNotice] = useState('')
  const [cloudModel, setCloudModel] = useState<CloudDecisionModel>()
  useEffect(() => {
    let active = true
    void Promise.all([
      window.douchat.getDecisionSettings(),
      window.douchat.getCloudDecisionModels().catch(() => [])
    ]).then(([value, models]) => {
      if (!active) return
      setSettings(desktopDecisionSettings(value))
      setCloudModel(models.find(model => model.protocol === 'jev'))
      setLoaded(true)
    }).catch(error => { if (active) setNotice(messageSendError(error)) })
    return () => { active = false }
  }, [])
  const mode = cloudModel && settings.mode !== 'leader' ? 'model' : 'leader'
  const update = (patch: Partial<Settings>) => { setSettings(value => ({ ...value, ...patch })); setNotice(''); setTestResult(undefined) }
  async function testConnection() {
    setTesting(true); setNotice(''); setTestResult(undefined)
    try {
      const result = await window.douchat.testDecisionSettings({ ...settings, mode: 'model', providerId: CLOUD_DECISION_PROVIDER_ID, model: '' })
      if (!result.ok) throw new Error(result.error || 'Decision connection failed.')
      setTestResult({})
    } catch (error) {
      const fallback: Settings = { ...settings, mode: 'leader', providerId: '', model: '' }
      setSettings(fallback)
      try {
        setSettings(await window.douchat.saveDecisionSettings(fallback))
        setTestResult({ error: messageSendError(error) })
      } catch (saveError) {
        setTestResult({ error: messageSendError(error), saveError: messageSendError(saveError) })
      }
    } finally { setTesting(false) }
  }
  async function save() {
    setBusy(true); setNotice(''); setTestResult(undefined)
    try {
      setSettings(await window.douchat.saveDecisionSettings({ ...settings, mode,
        providerId: mode === 'model' ? CLOUD_DECISION_PROVIDER_ID : '', model: '' }))
      setNotice('Group decision settings saved. They apply to the next task.')
    } catch (error) { setNotice(messageSendError(error)) }
    finally { setBusy(false) }
  }
  return <section className="decision-settings" aria-label={t("Group decision service")}>
    <h2>{t("Group decision service")}</h2><p className="settings-note">{t("Choose who decides whether group messages need a reply and which members handle them. Members still use their own models to do the work.")}</p>
    <fieldset disabled={!loaded || busy || testing}>
      <label className="field-row"><span>{t("Decision mode")}</span><select value={mode} onChange={event => update({ mode: event.target.value as Settings['mode'], providerId: event.target.value === 'model' ? CLOUD_DECISION_PROVIDER_ID : '', model: '' })}>
        <option value="leader">{t("Default")}</option>{cloudModel && <option value="model">{t("Decision model")}</option>}
      </select></label>
      {mode === 'leader' && <p className="settings-note decision-mode-note">{t("A group coordinator decides whether to reply, who handles the task, and in what order. No separate decision model is required.")}</p>}
      {mode === 'model' && <p className="settings-note decision-mode-note">{tr("Douchat cloud decisions use credits. Each successful call costs {credits} credits.", { credits: cloudModel!.creditsPerRequest })}</p>}
      <label className="field-row"><span>{t("Member health check interval (seconds)")}</span><input type="number" min={30} max={3600} step={30}
        value={settings.healthCheckIntervalSeconds ?? 300} onChange={event => update({ healthCheckIntervalSeconds: Number(event.target.value) })} /></label>
      <p className="settings-note">{t("Each group caches member availability and response time. New tasks refresh checks when the interval expires. Unavailable members receive no tasks until a successful check; unknown members may be rechecked after 30 seconds. Decisions consider health, skills, and response time.")}</p>
      <div className="decision-actions">
        {mode === 'model' && <button className="secondary-button" onClick={() => void testConnection()}>{t(testing ? "Testing…" : "Test connection")}</button>}
        <button className="primary-button" onClick={() => void save()}>{t("Save decision settings")}</button>
      </div>
      {mode === 'model' && <p className="settings-note">{t("A successful connection test is billed as one decision call.")}</p>}
    </fieldset>
    {testResult && <p role={testResult.error ? 'alert' : 'status'} className="settings-note">
      {testResult.error ? <>{t("Decision connection failed.")} {t(testResult.error)}{' '}{t(testResult.saveError
        ? "Default mode is selected but could not be saved. Save it again."
        : "Switched to default decision mode and saved.")}{testResult.saveError && <> {t(testResult.saveError)}</>}</>
        : t("Decision service connected.")}
    </p>}
    {notice && <p role="status" className="settings-note">{t(notice)}</p>}
  </section>
}
