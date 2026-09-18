export type ImeKeyEvent = Pick<KeyboardEvent, 'key' | 'code' | 'keyCode' | 'isComposing'>

export function isImeCommitEnter(event: ImeKeyEvent, composing: boolean): boolean {
  const enter = event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter' || event.keyCode === 13
  return enter && (composing || event.isComposing || event.keyCode === 229)
}
