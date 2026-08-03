import mammoth from 'mammoth';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'];

export async function extractText(
  buffer: ArrayBuffer,
  filename: string
): Promise<string> {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));

  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new Error(`Unsupported file type: ${ext}`);
  }

  try {
    if (ext === '.docx') {
      const result = await mammoth.extractRawText({
        buffer: Buffer.from(buffer),
      });
      return result.value || '';
    }

    if (ext === '.pdf') {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
        resolve(
          process.cwd(),
          'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
        )
      ).href;
      const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) })
        .promise;
      const pages = await Promise.all(
        Array.from({ length: doc.numPages }, (_, i) =>
          doc.getPage(i + 1).then((p) => p.getTextContent())
        )
      );
      return pages
        .flatMap((c) =>
          c.items
            .filter((item) => 'str' in item)
            .map((item) => (item as { str: string }).str)
        )
        .join(' ');
    }

    return new TextDecoder('utf-8').decode(buffer);
  } catch (err) {
    console.error('Extraction failed:', err);
    throw new Error('Could not extract text from document');
  }
}
