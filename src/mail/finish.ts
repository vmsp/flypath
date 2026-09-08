const DEV = process.env.NODE_ENV !== "production";

const PRELOAD = /<link\b[^>]*\brel="preload"[^>]*>/g;
const STYLE_TAG = /<style\b[^>]*>/g;
const HOISTED = /\s+data-(?:precedence|href)="[^"]*"/g;
const SUSPENSE = /<!--\/?\$[?!]?-->/g;
const SEPARATOR = /<!-- -->/g;

const MSO =
  "<!--[if mso]>" +
  "<xml><o:OfficeDocumentSettings>" +
  "<o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch>" +
  "</o:OfficeDocumentSettings></xml>" +
  "<style>* { mso-line-height-rule: exactly; }</style>" +
  "<![endif]-->";

const CLIP = 100_000;

export function finishEmail(html: string): string {
  const out = html
    .replace(PRELOAD, "")
    .replace(STYLE_TAG, (tag) => tag.replace(HOISTED, ""))
    .replace(SUSPENSE, "")
    .replace(SEPARATOR, "")
    .replace("<head>", `<head>${MSO}`);

  if (DEV && out.length > CLIP) {
    console.warn(
      `flypath: this email is ${String(
        Math.round(out.length / 1024),
      )} KB. Gmail clips a message past about 102 KB and hides the rest ` +
        'behind a "[Message clipped]" link, so trim the markup or move ' +
        "repeated declarations into a condition map, which becomes a class",
    );
  }
  return out;
}
