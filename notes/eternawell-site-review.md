# Eternawell — Site Review & Redesign Notes

Saved from a Claude Code session (2026-10-26 → 2026-11-03).

Note: the live site (eternawellmedical.com, "Eternawell Medical | Hormone & Wellness Clinic") is a
client-rendered React + Tailwind app with routes /services, /about, /membership, /products, /faq, /book.
The repo in this folder (`index.html`, `styles.css`) is a separate static landing page with a Three.js hero.

---

## Part 1 — Review of the repo landing page (index.html / styles.css)

1. **Broken conversion path** — "Book an intro call" has `href="#"`; all "Book" buttons funnel there. No phone,
   address, hours, map, or email anywhere. "Contact" nav item points at a CTA, not contact info. Footer is
   nearly empty (add address, hours, privacy policy / HIPAA notice, accessibility, socials).
2. **Content can disappear entirely** — `.reveal` starts at `opacity: 0` and the class that reveals it is added
   by the same module script that imports Three.js. If the CDN fails or WebGL is unavailable, the page stays
   invisible. Gate reveals behind a `js` class or init WebGL in `try/catch`.
3. **Mobile** — nav links hidden <860px with no hamburger; Approach section is 340vh with 45%-opacity faces;
   heavy WebGL hero (dense icosahedron + 700 particles) on phones.
4. **Trust** — no doctors, credentials, testimonials, pricing/insurance, FAQ.
5. **Stats** — counters render "0" in HTML (crawlers see 0); claims like "98% would recommend" need a source.
6. **Interaction/a11y** — tilt cards look clickable but aren't links; add skip link and focus styles; logo
   `href="#"`.
7. **Polish** — one dominant hero CTA; real photography; consistent naming (Clinic vs Medical).

---

## Part 2 — Review of the live site (rendered DOM)

### 1. Placeholder content still live (fix first)
- Phone `(555) 123-4567` used for Call to Book, Text to Book, and footer — all dead.
- Email `hello@eternawell.example` — reserved domain, undeliverable.
- Address "123 Wellness Way, Suite 200, Austin TX" looks templated; link real address to Maps.
- Socials `instagram.com/your-clinic`, `facebook.com/your-clinic`; generic icons (camera/globe).
- Image placeholders "Clinic photography", "Lab & consultation photo"; the lab one shows on mobile as a big
  empty 4:5 box.
- Membership step cards show only icons + "1 / 2 / 3" with no labels.

### 2. Lead with the strongest offer
- Free 20-minute consult is buried mid-page — move it into the hero.
- Unify CTA labels ("Book Now" / "Book Appointment" / consult) → e.g. "Book your free consult".
- "Every Member Starts Free" — show what it costs after (price or "from $X/mo").

### 3. Trust signals
- Provider photos, names, credentials ("Board-informed" reads vague — say "board-certified" if true).
- Reviews / Google rating.
- States served by telemedicine (licensing).
- Footer: privacy policy, terms, HIPAA notice, medical disclaimer. Have GLP-1 / mood-therapy claims
  compliance-reviewed.

### 4. Navigation
- Full nav only at ≥1280px (`xl`); trim to 4–5 items, move Products to footer, switch to `lg`.
- Keep Book visible on mobile (header button or sticky bottom bar).
- Add `lang="zh"` to the 中文 toggle; verify full translation.

### 5. Visual hierarchy
- Overuse of uppercase + wide tracking on every button/chip/link — reserve for eyebrows only.
- "Welcome to the Clinic" duplicated (hero eyebrow + image badge).
- Products section is a heading + link — show 3–4 products or shrink it.
- Brand naming: "Eternawell" vs "Eternawell Medical".

### 6. Technical
- Client-side rendering → crawlers see only the title. Pre-render / SSR (Vite prerender or Next.js) for
  local SEO ("hormone clinic Austin").
- Material Symbols ligatures can flash as raw text (`check_circle`) — `display=block` or inline SVG.
- Check contrast of footer copyright (tertiary token at 80% opacity).

### Quick-win order
1. Replace placeholder phone/email/address/socials.
2. Real photos (or hide empty boxes on mobile).
3. Membership step labels + pricing.
4. Free consult in hero; one CTA label.
5. Provider bios, reviews, licensed states, legal footer.
6. Pre-render for SEO.

---

## Part 3 — Making it more elaborate but still professional

**Core motif:** visualize "Normal Is Not Optimal" — a wide "normal range" band narrowing into a glowing
"optimal" zone; reuse as dividers, card gauges, etc.

**By section**
- Hero: real photo in arched frame with parallax; word-by-word headline reveal; slow gradient background.
- Approach: short sticky scroll story (Labs → Evaluation → Plan → Adjust), ~150–200vh.
- Services: bento grid with a featured card; animated line icons; cursor-follow glow; symptom-finder chips.
- Membership: scroll-drawn 3-step timeline; pricing table with monthly/annual toggle.
- Proof: real count-up stats, testimonial strip, stylized sample lab report (normal vs optimal).
- Providers: portrait cards with hover-reveal bio + "Book with Dr. X".
- Products: drag/snap carousel with "clinician's pick" notes.
- Final CTA: frosted card over drifting gradient; "Next available" if booking API allows.

**Global polish:** Lenis smooth scroll; consistent small entrance animations; route transitions
(Motion `AnimatePresence`); serif display + clean sans; faint grain, tinted shadows, sparing glass;
button/nav microinteractions; custom illustration set instead of generic icons.

**Tools:** Motion (Framer Motion), GSAP + ScrollTrigger, Lenis, Lottie / Rive, React Three Fiber (hero only).

**Guardrails:** calm motion; respect `prefers-reduced-motion`; content first; mobile performance; keep the
booking flow simple.

**Recommended first five:** real photography, the optimal-range motif, bento services, page transitions,
scroll-driven Approach section.

---

## Part 4 — 3D concept pages

See `concepts/glass.html` and `concepts/particles.html` (light palettes, Three.js).
