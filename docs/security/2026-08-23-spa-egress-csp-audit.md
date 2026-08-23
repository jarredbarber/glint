# SPA egress and CSP audit

## Scope

Static SPA sources under `src/spa/`, its client bundles, and the HTML entry point.

## Observed outbound destinations

| Destination | Data sent | Purpose |
| --- | --- | --- |
| `https://accounts.google.com/gsi/client` | None in the script URL | Google Identity Services loader for the Drive adapter. |
| `https://www.googleapis.com` | Drive OAuth bearer token; selected Drive file content and metadata | Drive list, read, write, create, delete, and optional user display name. |
| `https://api.github.com` | User-supplied GitHub PAT; selected repository file content and metadata | GitHub identity validation and Contents API operations. |
| `https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.css` | None | KaTeX stylesheet and referenced fonts. |

No source match was found for analytics, telemetry, beacons, WebSockets, `EventSource`, or `sendBeacon`. GitHub tokens remain in browser `localStorage`; Drive tokens remain in adapter memory.

## Draft CSP

Deploy as an HTTP response header through a host or proxy that supports custom headers. Native GitHub Pages cannot enforce `frame-ancestors`; a `<meta http-equiv="Content-Security-Policy">` fallback may constrain resource loading but must omit that directive.
```text
 default-src 'self';
 script-src 'self' https://accounts.google.com;
 style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net;
 font-src 'self' https://cdn.jsdelivr.net data:;
 img-src 'self' data: blob:;
 connect-src 'self' https://accounts.google.com https://www.googleapis.com https://api.github.com;
 frame-src https://accounts.google.com;
 object-src 'none';
 base-uri 'none';
 form-action 'none';
 frame-ancestors 'none'
```

`style-src 'unsafe-inline'` remains necessary for CodeMirror runtime styles. The policy intentionally permits only the four observed external origins.

## Decision needed

Validate the CSP against the deployed Pages site before enforcement. It constrains the user-configurable Drive/GitHub backends to their documented providers and could expose a newly added legitimate origin as a runtime failure.
