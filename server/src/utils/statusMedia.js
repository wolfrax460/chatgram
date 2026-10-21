/**
 * Status (story) media rules — one source of truth for the server.
 *
 * The client shows the same limits in its error messages; the server enforces
 * them again because a client can send anything.
 *
 *   image  up to 10 MB
 *   video  up to 50 MB and 60 seconds
 *   audio  up to 20 MB
 *
 * Duration for video is reported by the client (browsers know it from
 * `video.duration`). The server validates the number is present, numeric and
 * inside the limit; it does not re-encode or re-time the file.
 */

const MB = 1024 * 1024;

const LIMITS = {
  image: { maxBytes: 10 * MB, maxDurationSeconds: null },
  video: { maxBytes: 50 * MB, maxDurationSeconds: 60 },
  audio: { maxBytes: 20 * MB, maxDurationSeconds: 600 },
};

const MIME_TO_KIND = {
  'image/jpeg': 'image',
  'image/jpg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'image/heic': 'image',
  'image/heif': 'image',
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/quicktime': 'video',
  'audio/mpeg': 'audio',
  'audio/mp4': 'audio',
  'audio/x-m4a': 'audio',
  'audio/m4a': 'audio',
  'audio/ogg': 'audio',
  'audio/wav': 'audio',
  'audio/x-wav': 'audio',
  'audio/webm': 'audio',
  'audio/aac': 'audio',
};

const ALLOWED_MIMETYPES = Object.keys(MIME_TO_KIND);

function kindFor(mimetype) {
  return MIME_TO_KIND[String(mimetype || '').toLowerCase()] || null;
}

function formatMb(bytes) {
  return `${Math.round((Number(bytes) / MB) * 10) / 10} MB`;
}

/**
 * @returns {{ok: true, kind: string} | {ok: false, status: number, code: string, message: string}}
 */
function validateStatusMedia({ mimetype, size, durationSeconds }) {
  const kind = kindFor(mimetype);
  if (!kind) {
    return {
      ok: false,
      status: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message:
        'That file type cannot be used in a status. Use an image (jpg, png, webp, gif), a video (mp4, webm, mov) or audio (mp3, m4a, ogg, wav).',
    };
  }

  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return { ok: false, status: 400, code: 'EMPTY_MEDIA', message: 'The file is empty.' };
  }

  const limit = LIMITS[kind];
  if (bytes > limit.maxBytes) {
    return {
      ok: false,
      status: 413,
      code: 'MEDIA_TOO_LARGE',
      message: `That ${kind} is larger than the ${formatMb(limit.maxBytes)} limit.`,
      maxBytes: limit.maxBytes,
      kind,
    };
  }

  // Only video REQUIRES a duration: the 60-second cap is the rule that needs
  // it. Audio has a generous cap (10 minutes); when the client reports a
  // duration we still check it, but a missing value is not an error.
  const durationRequired = kind === 'video';
  if (limit.maxDurationSeconds) {
    if (durationSeconds === undefined || durationSeconds === null || durationSeconds === '') {
      if (!durationRequired) return { ok: true, kind };
      return {
        ok: false,
        status: 400,
        code: 'DURATION_REQUIRED',
        message: `The ${kind} duration could not be read. Try a different file.`,
      };
    }
    const seconds = Number(durationSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      if (!durationRequired) return { ok: true, kind };
      return {
        ok: false,
        status: 400,
        code: 'INVALID_DURATION',
        message: `The ${kind} duration could not be read. Try a different file.`,
      };
    }
    if (seconds > limit.maxDurationSeconds + 0.5) {
      return {
        ok: false,
        status: 400,
        code: 'MEDIA_TOO_LONG',
        message:
          kind === 'video'
            ? `Videos must be ${limit.maxDurationSeconds} seconds or shorter. Trim it and try again.`
            : `Audio must be ${Math.round(limit.maxDurationSeconds / 60)} minutes or shorter.`,
        maxDurationSeconds: limit.maxDurationSeconds,
        kind,
      };
    }
  }

  return { ok: true, kind };
}

/** Human-readable rules, used by GET /api/status/limits and by the client. */
function describeLimits() {
  return {
    image: { maxBytes: LIMITS.image.maxBytes, mimetypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] },
    video: {
      maxBytes: LIMITS.video.maxBytes,
      maxDurationSeconds: LIMITS.video.maxDurationSeconds,
      mimetypes: ['video/mp4', 'video/webm', 'video/quicktime'],
    },
    audio: {
      maxBytes: LIMITS.audio.maxBytes,
      maxDurationSeconds: LIMITS.audio.maxDurationSeconds,
      mimetypes: ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/x-m4a'],
    },
  };
}

module.exports = {
  LIMITS,
  MB,
  ALLOWED_MIMETYPES,
  kindFor,
  validateStatusMedia,
  describeLimits,
  formatMb,
};
