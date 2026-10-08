import { GoogleAdapter, googleAuthComplete, googleAuthStart } from './google.js'
import { MicrosoftAdapter, microsoftAuthComplete, microsoftAuthStart } from './microsoft.js'
import type { ConnectedAccount, MailAdapter, OAuthClientConfig, OAuthStart, ProviderName, TokenDataListener } from './types.js'

export * from './types.js'
export * from './clean.js'
export * from './filters.js'
export * from './threading.js'
export { parseGraphMessage, MICROSOFT_SCOPES } from './microsoft.js'
export { parseGmailMessage, GOOGLE_SCOPES } from './google.js'

/** Provider registry. IMAP/SMTP can be added here later behind the same interface. */
export const SUPPORTED_PROVIDERS: ProviderName[] = ['MICROSOFT', 'GOOGLE']

export function createAdapter(
  provider: ProviderName,
  cfg: OAuthClientConfig,
  tokenData: string,
  onTokenData?: TokenDataListener,
): MailAdapter {
  switch (provider) {
    case 'MICROSOFT':
      return new MicrosoftAdapter(cfg, tokenData, onTokenData)
    case 'GOOGLE':
      return new GoogleAdapter(cfg, tokenData, onTokenData)
    default:
      throw new Error(`Unsupported mail provider: ${provider satisfies never}`)
  }
}

export function startOAuth(provider: ProviderName, cfg: OAuthClientConfig, state: string): Promise<OAuthStart> {
  return provider === 'MICROSOFT' ? microsoftAuthStart(cfg, state) : googleAuthStart(cfg, state)
}

export function completeOAuth(
  provider: ProviderName,
  cfg: OAuthClientConfig,
  code: string,
  codeVerifier?: string,
): Promise<ConnectedAccount> {
  if (provider === 'MICROSOFT') {
    if (!codeVerifier) throw new Error('Missing PKCE verifier')
    return microsoftAuthComplete(cfg, code, codeVerifier)
  }
  return googleAuthComplete(cfg, code)
}
