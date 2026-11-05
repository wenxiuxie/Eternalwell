# EternaWell Medicine — website

Static website for EternaWell Medicine (Bellevue, WA). Netlify publishes the `site/` folder (see `netlify.toml`);
`/` redirects to the current version, **v7** (English `/v7/`, Chinese `/v7/zh/`). Earlier design versions are listed at `/versions/`.

## v7 at a glance

- Pages: Home, Services (4 areas), Meet the Doctor, Membership, Products, FAQ, Book, Legal — in English and Chinese.
- **Online booking without sign-up** on `/v7/book/` (`booking/`): patient page + doctor admin (`/v7/booking/web/admin.html`).
  It runs in **demo mode** (data stays in the visitor's browser) until `booking/web/config.js` points to the Google Apps Script backend in `booking/backend/Code.js`.
- Accessibility: WCAG 2.1 AA colour contrast in every palette, keyboard and screen-reader support, reduced-motion support.
- **Preview panel** (bottom-left, "预览设置"): switch colour palette and home-hero effect while the look is being chosen.
  Links like `/v7/?theme=noir&hero=show` open a specific look. Defaults are set in `site/v7/assets/theme.js`.

## Editing

Pages are generated from templates — edit `src/v7/` (not `site/v7/*.html`), then rebuild:

```bash
python -m pip install budoux   # Chinese line breaking (once)
bash tools/build.sh v7         # PREVIEW=0 bash tools/build.sh v7  → build without the preview panel (for launch)
```

- English templates: `src/v7/pages/`, `src/v7/partials/`; Chinese: `src/v7/pages-zh/`, `src/v7/partials-zh/`.
- Clinic details (phone, address, doctor name placeholders) are at the top of `tools/build.sh`.
- Styles and scripts: `site/v7/assets/` (edited directly, not generated).
- Images: `site/v7/assets/img/` — sources in `CREDITS.md` (temporary Unsplash photos + original 3D renders from `tools/render/`).

## Still to come from the doctor

Doctor's name, portrait photo and bio; specific screening tests; clinic email; whether the clinic bills insurance
(decides the HIPAA notice); real patient testimonials; shop links on the Products page. Legal texts are drafts for attorney review.

## Local preview

```bash
cd site && python -m http.server 8010   # then open http://127.0.0.1:8010/v7/
```
