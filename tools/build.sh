#!/usr/bin/env bash
# Builds one site version from its templates: site/<version> from src/<version>.
# Change clinic details below, then run:  bash tools/build.sh v6   (or v5)
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:?usage: bash tools/build.sh <version, e.g. v6>}"
SRC="src/$VERSION"
OUT="site/$VERSION"
[ -d "$SRC" ] || { echo "no templates in $SRC" >&2; exit 1; }
export BASE="/$VERSION"

# ---- Clinic details ----
export PORTAL_URL="https://www.optimantra.com/optimus/om/patient/login"
export SHOP_SKIN_URL="https://your-clinic-shop.example/skin-hair"
export SHOP_SUPP_URL="https://your-clinic-shop.example/hormone-supplements"
if [ "$VERSION" = v7 ]; then
  # Real details from the doctor (2026-10-21). v7 has no email address on purpose (none provided yet).
  export CLINIC="EternaWell Medicine"
  export PHONE_DISPLAY="(206) 507-2504"
  export PHONE_TEL="+12065072504"
  export ADDRESS_1="2700 Richards Rd, Suite 204A"
  export ADDRESS_2="Bellevue, WA 98005"
  export CITY="Bellevue, WA"
  export MAP_URL="https://www.google.com/maps/search/?api=1&amp;query=2700+Richards+Rd+Suite+204A+Bellevue+WA+98005"
  export LEGAL_UPDATED="November 5, 2026"
  # Doctor's bio: fill these in when the doctor sends them (shown highlighted until then)
  export DOCTOR_NAME='<span class="todo">[Doctor&rsquo;s full name], MD</span>'
  export DOCTOR_SHORT='<span class="todo">[Dr. Last name]</span>'
else
  # Placeholders from the original site (v5, v6)
  export PHONE_DISPLAY="(555) 123-4567"
  export PHONE_TEL="+15551234567"
  export EMAIL="hello@eternawell.example"
  export ADDRESS_1="123 Wellness Way, Suite 200"
  export ADDRESS_2="Austin, TX 78701"
fi

# ---- Shared icons ----
export ARROW='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2 8h11M9 4l4 4-4 4"/></svg>'
export CHECK='<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10" cy="10" r="8.2"/><path d="M6.4 10.2l2.4 2.4 4.8-5"/></svg>'
export EXT='<svg class="ext-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 3h7v7M13 3L4 12"/></svg>'

# ---- 3D particle field, only on pages with "@field 1" ----
# ROOT is where shared files live (assets, booking widget); BASE is where this language's pages live.
export ROOT="/$VERSION"
FIELD_CANVAS_ON='<canvas id="field" aria-hidden="true"></canvas>'
FIELD_SCRIPTS_ON="<script type=\"importmap\">{ \"imports\": { \"three\": \"/vendor/three.module.js\" } }</script>
<script type=\"module\" src=\"$ROOT/assets/field.js\"></script>"

# Preview-only settings panel (palette + home hero). Set PREVIEW=0 to build without it for launch.
if [ "$VERSION" = v7 ] && [ "${PREVIEW:-1}" = 1 ]; then
  export PREVIEW_PANEL="$(cat "$SRC/partials/preview-panel.html")"
else
  export PREVIEW_PANEL=""
fi

# build_pages <pages dir> <partials dir> <output dir>
build_pages() {
  local pages="$1" partials="$2" out="$3"
  for page in "$pages"/*.html; do
    name=$(basename "$page" .html)
    export PAGE="$name"
    export TITLE="$(sed -n 's/^@title //p' "$page")"
    export DESC="$(sed -n 's/^@desc //p' "$page")"
    export SHAPE="$(sed -n 's/^@shape //p' "$page")"
    export CLASS="$(sed -n 's/^@class //p' "$page")"
    if [ "$(sed -n 's/^@field //p' "$page")" = 1 ]; then
      export FIELD_CANVAS="$FIELD_CANVAS_ON" FIELD_SCRIPTS="$FIELD_SCRIPTS_ON"
    else
      export FIELD_CANVAS="" FIELD_SCRIPTS=""
    fi

    if [ "$name" = home ]; then
      dest="$out/index.html"; export PAGE_PATH="/"
    else
      mkdir -p "$out/$name"
      dest="$out/$name/index.html"; export PAGE_PATH="/$name/"
    fi
    export ALT_URL="${ALT_BASE:-}$PAGE_PATH" EN_URL="$ROOT$PAGE_PATH" ZH_URL="$ROOT/zh$PAGE_PATH"

    {
      cat "$partials/head.html" "$partials/header.html"
      grep -v '^@[a-z]' "$page"
      cat "$partials/footer.html"
    } | CTA_FILE="$partials/cta.html" perl -pe 'if (/^\s*\@\@CTA\@\@\s*$/) { local $/; open my $f, "<", $ENV{CTA_FILE} or die "missing $ENV{CTA_FILE}
"; $_ = <$f>; }'       | perl -pe 's/\{\{(\w+)\}\}/exists $ENV{$1} ? $ENV{$1} : die "unknown placeholder {{$1}}
"/ge; s/data-page="\Q$ENV{PAGE}\E"/data-page="$ENV{PAGE}" aria-current="page"/g'       > "$dest"
    echo "built $dest"
  done
}

export BASE="/$VERSION" ALT_BASE="/$VERSION/zh"
build_pages "$SRC/pages" "$SRC/partials" "$OUT"

# v7 Chinese: same layout, Chinese templates in pages-zh/ and partials-zh/, published under /v7/zh/
if [ -d "$SRC/pages-zh" ]; then
  export BASE="/$VERSION/zh" ALT_BASE="/$VERSION"
  export CITY="华盛顿州贝尔维尤" LEGAL_UPDATED="2026 年 11 月 5 日"
  export DOCTOR_NAME='<span class="todo">［医生全名］，医学博士</span>'
  export DOCTOR_SHORT='<span class="todo">［X 医生］</span>'
  if [ "${PREVIEW:-1}" = 1 ]; then export PREVIEW_PANEL="$(cat "$SRC/partials/preview-panel.html")"; fi
  mkdir -p "$OUT/zh"
  build_pages "$SRC/pages-zh" "$SRC/partials-zh" "$OUT/zh"
  # Chinese line breaks between phrases, not inside words (needs: python -m pip install budoux)
  if python -c "import budoux" 2>/dev/null; then
    PYTHONIOENCODING=utf-8 python tools/zh_phrases.py "$OUT/zh"
  else
    echo "WARNING: budoux not installed, Chinese headings may break inside words (python -m pip install budoux)" >&2
  fi
fi

# v7: the no-sign-up booking widget (patient page + doctor admin), embedded on /v7/book/
if [ "$VERSION" = v7 ]; then
  rm -rf "$OUT/booking"
  mkdir -p "$OUT/booking"
  cp -r booking/web booking/backend "$OUT/booking/"
  echo "copied booking widget to $OUT/booking"
fi
