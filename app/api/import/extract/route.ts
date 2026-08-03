import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/getAuthUser';
import { extractText } from '@/lib/import/extractor';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'];
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
];

function getExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? '.' + parts[parts.length - 1].toLowerCase() : '';
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file)
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    if (file.size > MAX_FILE_SIZE)
      return NextResponse.json(
        { error: 'File size exceeds 5MB limit' },
        { status: 400 }
      );

    const extension = getExtension(file.name);
    if (!ALLOWED_EXTENSIONS.includes(extension))
      return NextResponse.json(
        { error: 'File type not supported. Allowed: .pdf, .docx, .txt, .md' },
        { status: 400 }
      );

    if (!ALLOWED_MIME_TYPES.includes(file.type))
      return NextResponse.json(
        { error: 'MIME type not supported' },
        { status: 400 }
      );

    const buffer = await file.arrayBuffer();
    const text = await extractText(buffer, file.name);

    if (!text || !text.trim())
      return NextResponse.json(
        { error: 'Document appears to be empty or scanned.' },
        { status: 400 }
      );

    return NextResponse.json({ text });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to extract text';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
