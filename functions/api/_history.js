// D1 + R2 backed history store for OmniTranscribe
// All queries are scoped by session_key for user isolation

/**
 * List transcripts for a session (lightweight — no segments)
 */
async function listHistory(db, sessionKey) {
  const { results } = await db
    .prepare(
      "SELECT id, file_name, created_at, summary, detected_languages, audio_key FROM transcripts WHERE session_key = ? ORDER BY created_at DESC"
    )
    .bind(sessionKey)
    .all();

  return results.map((row) => ({
    id: row.id,
    file_name: row.file_name,
    created_at: row.created_at,
    summary: row.summary,
    detected_languages: row.detected_languages
      ? JSON.parse(row.detected_languages)
      : null,
    audio_key: row.audio_key,
  }));
}

/**
 * Get a full transcript by ID, scoped to session
 */
async function getHistory(db, id, sessionKey) {
  const row = await db
    .prepare(
      "SELECT id, file_name, created_at, summary, detected_languages, audio_key FROM transcripts WHERE id = ? AND session_key = ?"
    )
    .bind(id, sessionKey)
    .first();

  if (!row) return null;

  const { results: segmentRows } = await db
    .prepare(
      "SELECT sort_order, speaker, content, start_time, end_time, language, language_code, languages, emotion, translation, words FROM segments WHERE transcript_id = ? ORDER BY sort_order"
    )
    .bind(id)
    .all();

  const segments = segmentRows.map((s) => ({
    start: s.start_time,
    end: s.end_time,
    speaker: s.speaker,
    text: s.content,
    language: s.language,
    language_code: s.language_code,
    languages: s.languages ? JSON.parse(s.languages) : null,
    emotion: s.emotion,
    translation: s.translation,
    words: s.words ? JSON.parse(s.words) : null,
  }));

  return {
    id: row.id,
    file_name: row.file_name,
    created_at: row.created_at,
    summary: row.summary,
    detected_languages: row.detected_languages
      ? JSON.parse(row.detected_languages)
      : null,
    audio_key: row.audio_key,
    audio_url: row.audio_key ? `/api/audio/${row.id}` : null,
    segments,
  };
}

/**
 * Insert a full transcript with session_key
 */
async function putHistory(db, item, sessionKey) {
  await db
    .prepare(
      "INSERT OR REPLACE INTO transcripts (id, file_name, created_at, summary, detected_languages, audio_key, session_key) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      item.id,
      item.file_name,
      item.created_at,
      item.summary || null,
      item.detected_languages ? JSON.stringify(item.detected_languages) : null,
      item.audio_key || null,
      sessionKey
    )
    .run();

  if (item.segments && item.segments.length > 0) {
    const stmt = db.prepare(
      "INSERT INTO segments (transcript_id, sort_order, speaker, content, start_time, end_time, language, language_code, languages, emotion, translation, words) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );

    const batchSize = 100;
    for (let i = 0; i < item.segments.length; i += batchSize) {
      const batch = item.segments.slice(i, i + batchSize).map((seg, idx) =>
        stmt.bind(
          item.id,
          i + idx,
          seg.speaker || null,
          seg.text || seg.content || null,
          seg.start || 0,
          seg.end || 0,
          seg.language || null,
          seg.language_code || null,
          seg.languages ? JSON.stringify(seg.languages) : null,
          seg.emotion || "neutral",
          seg.translation || null,
          seg.words ? JSON.stringify(seg.words) : null
        )
      );
      await db.batch(batch);
    }
  }

  return item;
}

/**
 * Update a transcript, scoped to session
 */
async function updateHistory(db, id, patch, sessionKey) {
  // Verify ownership
  const existing = await getHistory(db, id, sessionKey);
  if (!existing) return null;

  const updates = [];
  const binds = [];

  if (patch.file_name !== undefined) {
    updates.push("file_name = ?");
    binds.push(patch.file_name);
  }
  if (patch.summary !== undefined) {
    updates.push("summary = ?");
    binds.push(patch.summary);
  }
  if (patch.detected_languages !== undefined) {
    updates.push("detected_languages = ?");
    binds.push(JSON.stringify(patch.detected_languages));
  }

  if (updates.length > 0) {
    binds.push(id, sessionKey);
    await db
      .prepare(
        `UPDATE transcripts SET ${updates.join(", ")} WHERE id = ? AND session_key = ?`
      )
      .bind(...binds)
      .run();
  }

  if (patch.segments) {
    await db
      .prepare("DELETE FROM segments WHERE transcript_id = ?")
      .bind(id)
      .run();

    const stmt = db.prepare(
      "INSERT INTO segments (transcript_id, sort_order, speaker, content, start_time, end_time, language, language_code, languages, emotion, translation, words) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );

    const batchSize = 100;
    for (let i = 0; i < patch.segments.length; i += batchSize) {
      const batch = patch.segments.slice(i, i + batchSize).map((seg, idx) =>
        stmt.bind(
          id,
          i + idx,
          seg.speaker || null,
          seg.text || seg.content || null,
          seg.start || 0,
          seg.end || 0,
          seg.language || null,
          seg.language_code || null,
          seg.languages ? JSON.stringify(seg.languages) : null,
          seg.emotion || "neutral",
          seg.translation || null,
          seg.words ? JSON.stringify(seg.words) : null
        )
      );
      await db.batch(batch);
    }
  }

  return await getHistory(db, id, sessionKey);
}

/**
 * Delete a transcript, scoped to session
 */
async function deleteHistory(db, bucket, id, sessionKey) {
  const row = await db
    .prepare("SELECT audio_key FROM transcripts WHERE id = ? AND session_key = ?")
    .bind(id, sessionKey)
    .first();

  if (!row) return false;

  const { meta } = await db
    .prepare("DELETE FROM transcripts WHERE id = ? AND session_key = ?")
    .bind(id, sessionKey)
    .run();

  if (row.audio_key && bucket) {
    try {
      await bucket.delete(row.audio_key);
    } catch (e) {
      console.error("Failed to delete R2 object:", e);
    }
  }

  return meta.changes > 0;
}

/**
 * Store an audio file in R2
 */
async function storeAudio(bucket, id, filename, arrayBuffer, mimeType) {
  const ext = filename.split(".").pop() || "wav";
  const key = `audio/${id}.${ext}`;
  await bucket.put(key, arrayBuffer, {
    httpMetadata: { contentType: mimeType || "audio/wav" },
    customMetadata: { originalFilename: filename },
  });
  return key;
}

/**
 * Retrieve audio from R2 (verifies session ownership first)
 */
async function getAudioForSession(db, bucket, transcriptId, sessionKey) {
  const row = await db
    .prepare("SELECT audio_key FROM transcripts WHERE id = ? AND session_key = ?")
    .bind(transcriptId, sessionKey)
    .first();

  if (!row || !row.audio_key) return null;
  return await bucket.get(row.audio_key);
}

/**
 * Log an edit
 */
async function logEdit(db, transcriptId, segmentOrder, field, oldValue, newValue) {
  await db
    .prepare(
      "INSERT INTO edits (transcript_id, segment_sort_order, field, old_value, new_value) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(transcriptId, segmentOrder, field, oldValue, newValue)
    .run();
}

/**
 * Helper: extract session key from request header
 */
function getSessionKey(request) {
  return request.headers.get("x-session-key") || null;
}

export {
  listHistory,
  getHistory,
  putHistory,
  updateHistory,
  deleteHistory,
  storeAudio,
  getAudioForSession,
  logEdit,
  getSessionKey,
};
