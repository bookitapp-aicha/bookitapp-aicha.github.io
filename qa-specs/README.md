# QA-specs

Deployable copy of the **Bookit QA Handbook** — the onboarding document for new QA testers.

## Contents

| File | Purpose |
|---|---|
| `index.html` | **The deliverable.** Fully self-contained single-file page. Upload this. |
| `bookit-qa-handbook.md` | The same content as Markdown — keep it for diffs and version control. |
| `_build/` | Build tooling. **Do not upload.** See *Rebuilding* below. |

## Deploying

Drop `index.html` anywhere that serves static files. There is no build step, no bundler, and no server-side requirement.

```bash
# Example: a subdirectory on an existing site
scp index.html user@server:/var/www/html/qa/index.html
#  -> https://your-server/qa/
```

Works equally on S3 + CloudFront, Nginx, Apache, Vercel, Netlify, or GitHub Pages. Opening the file directly from disk (`file://`) also works.

## Self-contained — what that means here

`index.html` makes **zero external resource requests**:

- All three typefaces (Archivo, JetBrains Mono, Source Serif 4) are embedded as base64 `woff2` inside the stylesheet — latin + latin-ext subsets, deduplicated across weights since all three are variable fonts.
- All CSS and JavaScript are inline. No libraries, no CDN.
- The favicon is an inline SVG data URI.

It renders identically on a fully air-gapped machine. The only outbound URLs in the file are the six **environment links** in the launchpad section, which are navigation targets the reader clicks — not resources the page loads.

File size is ~655 KB, almost entirely font data. It compresses well: enable gzip or brotli on the server and it goes over the wire at roughly 400 KB.

## Behaviour notes

- **Theme** — follows the reader's OS light/dark setting automatically.
- **Smoke-test checklist (§12)** — tick state is saved in that browser's `localStorage`, so it is *per reader, per browser*. It is not shared between testers and is not sent anywhere. "Reset run" clears it for the next release.
- **`noindex, nofollow`** is set in the head, since this is internal documentation. Remove that meta tag if you deliberately want it indexed.
- **Responsive** down to phone width; the nav rail collapses above the content below 980px.

## Rebuilding

Only needed if the handbook content changes. Source of truth is `../bookit-qa-handbook.html` (the artifact file).

```bash
cd _build
python inline_fonts2.py   # re-downloads woff2 subsets, writes fonts-inlined.css
python build.py           # assembles ../index.html
```

`inline_fonts2.py` needs network access (fonts.gstatic.com). `fonts.css` is the cached Google Fonts stylesheet that lists which subsets to fetch; refresh it only if the typeface list changes.
