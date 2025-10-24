import type { VoiceTranscriptionCursor } from '../../services/VoiceActivityRepository';

export function parseTimestamp(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const candidate = new Date(value);
    return Number.isNaN(candidate.getTime()) ? null : candidate;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      const fromNumber = new Date(numeric);
      if (!Number.isNaN(fromNumber.getTime())) {
        return fromNumber;
      }
    }

    const fromString = new Date(trimmed);
    if (!Number.isNaN(fromString.getTime())) {
      return fromString;
    }
  }

  return null;
}

export function parseVoiceTranscriptionCursor(value: unknown): VoiceTranscriptionCursor | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(':');
  if (parts.length !== 2) {
    return null;
  }

  const [timestampPart, idPart] = parts;
  const timestampMs = Number(timestampPart);
  const idValue = Number(idPart);

  if (!Number.isFinite(timestampMs) || !Number.isFinite(idValue)) {
    return null;
  }

  const timestamp = new Date(Math.floor(timestampMs));
  if (Number.isNaN(timestamp.getTime())) {
    return null;
  }

  return { timestamp, id: Math.floor(idValue) };
}

export function serializeVoiceTranscriptionCursor(
  cursor: VoiceTranscriptionCursor | null,
): string | null {
  if (!cursor) {
    return null;
  }

  const timestamp = cursor.timestamp instanceof Date ? cursor.timestamp : new Date(cursor.timestamp);
  const timestampMs = timestamp.getTime();
  const idValue = Number(cursor.id);

  if (!Number.isFinite(timestampMs) || Number.isNaN(timestampMs) || !Number.isFinite(idValue)) {
    return null;
  }

  return `${Math.floor(timestampMs)}:${Math.floor(idValue)}`;
}
