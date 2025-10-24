import path from 'path';

export function normalizeRecordingFileName(userId: string, fileName: string): string {
  const normalizedUserId = typeof userId === 'string' && userId.trim().length > 0 ? userId.trim() : 'membre';
  const parsed = path.parse(typeof fileName === 'string' && fileName.trim().length > 0 ? fileName : 'enregistrement.wav');
  const base = `${normalizedUserId}-${parsed.name || 'enregistrement'}`;
  const sanitizedBase = base
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+/, '')
    .replace(/_+$/, '');
  const safeBase = sanitizedBase.length > 0 ? sanitizedBase : 'enregistrement';
  const extension = parsed.ext && parsed.ext.length <= 10 ? parsed.ext.toLowerCase() : '.wav';
  const normalizedExtension = extension.startsWith('.') ? extension : `.${extension}`;
  return `${safeBase}${normalizedExtension}`;
}

export function getRecordingContentType(fileName: string): string {
  if (typeof fileName !== 'string') {
    return 'audio/wav';
  }
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.mp3')) {
    return 'audio/mpeg';
  }
  if (lower.endsWith('.ogg')) {
    return 'audio/ogg';
  }
  return 'audio/wav';
}
