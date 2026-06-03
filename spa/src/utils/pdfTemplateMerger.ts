import { PDFDocument } from "pdf-lib";

/**
 * Stamps the first page of a corporate template PDF as a background onto every
 * page of the generated content PDF, producing a merged output.
 *
 * Both PDFs must be the same page size (A4 landscape) for the overlay to align.
 */
export async function mergeWithTemplate(
  contentPdfBytes: ArrayBuffer,
  templatePdfBytes: ArrayBuffer,
): Promise<Uint8Array> {
  const contentDoc  = await PDFDocument.load(contentPdfBytes);
  const templateDoc = await PDFDocument.load(templatePdfBytes);
  const outputDoc   = await PDFDocument.create();

  // Embed the template's first page once — reused as background on all pages.
  const templateEmbeds = await outputDoc.embedPdf(templateDoc, [0]);
  const templateEmbed  = templateEmbeds[0];
  if (!templateEmbed) throw new Error("Corporate template PDF has no pages");

  // Embed all content pages in a single call for efficiency.
  const contentEmbeds = await outputDoc.embedPdf(contentDoc);

  for (let i = 0; i < contentEmbeds.length; i++) {
    const contentEmbed = contentEmbeds[i]!;
    const { width, height } = contentDoc.getPage(i).getSize();

    const newPage = outputDoc.addPage([width, height]);

    // Template drawn first (background), then content on top.
    newPage.drawPage(templateEmbed, { x: 0, y: 0, width, height });
    newPage.drawPage(contentEmbed,  { x: 0, y: 0, width, height });
  }

  return outputDoc.save();
}
