// Browser-only Wix Headless adapter: a single shared client (OAuth for members),
// Wix-managed login flow, and a ProgressBackend backed by the `progress` CMS
// collection. Kept out of the node test build (see tsconfig.test.json) because
// the @wix/* packages are bundler-resolved; the pure logic lives in cloudStore.ts.
import { createClient, OAuthStrategy } from '@wix/sdk'
import { items } from '@wix/data'
import type { ProgressBackend, ProgressItem } from './cloudStore'

// Public OAuth Client ID of the Word Castle headless project (safe to embed).
const CLIENT_ID = '01785127-e3a3-4320-aaab-ac9af95490aa'
const COLLECTION = 'progress'
const TOKENS_KEY = 'wcWixTokens'
const OAUTH_KEY = 'wcWixOAuthData'

function readJson<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : null
  } catch {
    return null
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const savedTokens = readJson<any>(TOKENS_KEY)
const client = createClient({
  modules: { items },
  auth: OAuthStrategy({ clientId: CLIENT_ID, tokens: savedTokens ?? undefined }),
})

/** Current app URL without query/hash — used as the OAuth redirect target, so it
 * must be listed in the OAuth app's allowed redirect URIs. */
function appUri(): string {
  return window.location.origin + window.location.pathname
}

export function isLoggedIn(): boolean {
  try {
    return client.auth.loggedIn()
  } catch {
    return false
  }
}

/** Kick off Wix-managed login: store PKCE data, then redirect to the Wix login page. */
export async function startLogin(): Promise<void> {
  const oauthData = client.auth.generateOAuthData(appUri(), window.location.href)
  localStorage.setItem(OAUTH_KEY, JSON.stringify(oauthData))
  const { authUrl } = await client.auth.getAuthUrl(oauthData)
  window.location.href = authUrl
}

/** If the current URL is a login callback, finish the token exchange and clean the
 * URL. Returns 'ok' on success, 'error' on a failed callback, 'none' otherwise. */
export async function completeLoginIfCallback(): Promise<'ok' | 'error' | 'none'> {
  if (!/[?#&](code|error)=/.test(window.location.href)) return 'none'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oauthData = readJson<any>(OAUTH_KEY)
  if (!oauthData) return 'none'
  const returned = client.auth.parseFromUrl()
  const cleanUrl = appUri()
  if (returned.error) {
    localStorage.removeItem(OAUTH_KEY)
    window.history.replaceState({}, document.title, cleanUrl)
    console.error('Wix login error:', returned.errorDescription)
    return 'error'
  }
  const tokens = await client.auth.getMemberTokens(returned.code!, returned.state!, oauthData)
  client.auth.setTokens(tokens)
  localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens))
  localStorage.removeItem(OAUTH_KEY)
  window.history.replaceState({}, document.title, cleanUrl)
  return 'ok'
}

export async function logout(): Promise<void> {
  localStorage.removeItem(TOKENS_KEY)
  try {
    const { logoutUrl } = await client.auth.logout(appUri())
    window.location.href = logoutUrl
  } catch {
    window.location.reload()
  }
}

/** ProgressBackend over the author-scoped `progress` collection: each query
 * returns only the logged-in member's items, so no manual member filtering. */
export function makeCloudBackend(): ProgressBackend {
  return {
    async fetch(course: string): Promise<ProgressItem | null> {
      const res = await client.items.query(COLLECTION).eq('course', course).find()
      return (res.items[0] as ProgressItem | undefined) ?? null
    },
    async upsert(item: ProgressItem): Promise<void> {
      await client.items.save(COLLECTION, item as Record<string, unknown>)
    },
  }
}
