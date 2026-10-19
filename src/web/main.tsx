import { provideRandomUUID } from './insecureContext'
import { normalizeAppAddress } from './site'
import { createWebApi } from './webApi'

// The desktop UI reads `window.douchat` as soon as it loads, so install the
// web implementation first and only then start the shared renderer.
provideRandomUUID()
normalizeAppAddress()
window.douchat = createWebApi()
void import('../renderer/src/main')
