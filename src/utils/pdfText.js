// src/utils/pdfText.js
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.js";

// Estrae testo da un Buffer (o Uint8Array)
export async function extractPdfText(buffer) {
  const loadingTask = pdfjsLib.getDocument({ data: buffer });
  const pdf = await loadingTask.promise;
  let fullText = "";

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const strings = content.items.map(i => i.str);
    fullText += strings.join(" ") + "\n\n";
  }

  return fullText.replace(/\s+/g, " ").trim();
}
