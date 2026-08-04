'use client';

import type { RouteErrorProps } from '@/lib/route-params';

/**
 * The last resort — this renders only when the root layout itself failed, which means the
 * providers, the token stylesheet and the translation context are all unavailable.
 *
 * It therefore ships its own `<html>` and `<body>`, uses no design-system component and no
 * translation. It is deliberately the one screen in the app with literal English strings:
 * reaching for `useTranslations` here would fail for the same reason the layout did.
 *
 * The copy still follows D-7: it says what happened and what to do next, does not apologise
 * and does not blame.
 */
export default function GlobalError({ error, reset }: RouteErrorProps) {
  return (
    <html lang="en" dir="ltr">
      <body
        style={{
          margin: 0,
          minBlockSize: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: '2rem',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
        }}
      >
        <main style={{ maxInlineSize: '32rem' }}>
          <h1 style={{ fontSize: '1.5rem', marginBlockEnd: '0.75rem' }}>Drape stopped loading</h1>
          <p style={{ marginBlockEnd: '1.5rem', lineHeight: 1.6 }}>
            Something went wrong before the page could start. Reload to try again — nothing you
            saved has been lost.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              minBlockSize: '44px',
              minInlineSize: '44px',
              paddingInline: '1.25rem',
              borderRadius: '8px',
              border: '1px solid currentColor',
              background: 'transparent',
              font: 'inherit',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
          {error.digest && (
            <p style={{ marginBlockStart: '1.5rem', fontSize: '0.75rem', opacity: 0.7 }}>
              Reference: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
