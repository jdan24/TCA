/**
 * Parses a .docx file (which is a ZIP archive) to extract:
 *   - The logo image from the Word header (first image found)
 *   - All body paragraph text (used as the disclaimer page)
 *
 * Uses JSZip for ZIP extraction and the browser's built-in DOMParser for XML.
 * No server required — runs entirely in the browser.
 */

import JSZip from "jszip";

export interface DocxTemplate {
  logoDataUrl: string | null;
  logoAspect: number;        // width / height ratio; fallback 3 when unknown
  disclaimerParagraphs: string[];
}

// ── XML namespace constants used in OOXML ─────────────────────────────────────
const NS_DRAWINGML = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_REL       = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL   = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_W         = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

// ── Public API ────────────────────────────────────────────────────────────────

export async function parseDocxTemplate(buffer: ArrayBuffer): Promise<DocxTemplate> {
  const zip = await JSZip.loadAsync(buffer);

  const [logoDataUrl, logoAspect] = await extractHeaderLogo(zip);
  const disclaimerParagraphs      = await extractBodyParagraphs(zip);

  return { logoDataUrl, logoAspect, disclaimerParagraphs };
}

// ── Logo extraction ───────────────────────────────────────────────────────────

async function extractHeaderLogo(zip: JSZip): Promise<[string | null, number]> {
  // Word headers are word/header1.xml, header2.xml, header3.xml.
  // Try each in order until we find one with an embedded image.
  for (let n = 1; n <= 3; n++) {
    const headerPath = `word/header${n}.xml`;
    const relsPath   = `word/_rels/header${n}.xml.rels`;

    const headerFile = zip.file(headerPath);
    const relsFile   = zip.file(relsPath);
    if (!headerFile || !relsFile) continue;

    const headerXml = await headerFile.async("string");
    const relsXml   = await relsFile.async("string");

    const parser    = new DOMParser();
    const headerDoc = parser.parseFromString(headerXml, "application/xml");
    const relsDoc   = parser.parseFromString(relsXml,   "application/xml");

    // Find first <a:blip r:embed="rIdN"/>
    const blips = headerDoc.getElementsByTagNameNS(NS_DRAWINGML, "blip");
    for (const blip of Array.from(blips)) {
      const rId = blip.getAttributeNS(NS_REL, "embed");
      if (!rId) continue;

      // Resolve rId → media file target in rels
      const rels = relsDoc.getElementsByTagNameNS(NS_PKG_REL, "Relationship");
      for (const rel of Array.from(rels)) {
        if (rel.getAttribute("Id") !== rId) continue;

        // Target is relative to word/, e.g. "media/image1.png" or "../media/image1.png"
        const target    = rel.getAttribute("Target") ?? "";
        const mediaPath = `word/${target.replace(/^\.\.\//, "")}`;
        const imageFile = zip.file(mediaPath);
        if (!imageFile) continue;

        const imageBytes  = await imageFile.async("uint8array");
        const ext         = mediaPath.split(".").pop()?.toLowerCase() ?? "png";
        const mimeType    = ext === "jpg" || ext === "jpeg" ? "image/jpeg"
                          : ext === "svg" ? "image/svg+xml"
                          : "image/png";
        const base64      = uint8ToBase64(imageBytes);
        const dataUrl     = `data:${mimeType};base64,${base64}`;
        const aspect      = await measureImageAspect(dataUrl);
        return [dataUrl, aspect];
      }
    }
  }

  return [null, 3]; // no logo found; fallback aspect 3:1
}

// ── Body text extraction ──────────────────────────────────────────────────────

async function extractBodyParagraphs(zip: JSZip): Promise<string[]> {
  const docFile = zip.file("word/document.xml");
  if (!docFile) return [];

  const xml    = await docFile.async("string");
  const parser = new DOMParser();
  const doc    = parser.parseFromString(xml, "application/xml");

  const paragraphs: string[] = [];
  const paras = doc.getElementsByTagNameNS(NS_W, "p");

  for (const para of Array.from(paras)) {
    const runs  = para.getElementsByTagNameNS(NS_W, "t");
    const text  = Array.from(runs)
      .map((r) => r.textContent ?? "")
      .join("");
    if (text.trim()) paragraphs.push(text.trim());
  }

  return paragraphs;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function measureImageAspect(dataUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload  = () => resolve(img.naturalWidth / Math.max(img.naturalHeight, 1));
    img.onerror = () => resolve(3); // fallback 3:1 if image can't be decoded
    img.src = dataUrl;
  });
}
