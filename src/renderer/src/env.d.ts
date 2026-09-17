import type { DouchatApi } from '../../shared/types'

declare global {
  interface Window {
    douchat: DouchatApi
  }
}

export {}
