// D1 + R2 backed history store for OmniTranscribe
// env.DB = D1 database binding
// env.AUDIO_BUCKET = R2 bucket binding

/**
 * List all transcripts (lightweight — no segments)
 */
async function listHistory(db) {
  const { results } = await db
    .prepare(
      "SELECT id, file_name, created_at, summary, detected_languages, audio_key FROM transcripts ORDER BY created_at DESC"
    )
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
 * Get a full transcript by ID (with all segments)
 */
async function getHistory(db, id) {
  const row = await db
    .prepare(
      "SELECT id, file_name, created_at, summary, detected_languages, audio_key FROM transcripts WHERE id = ?"
    )
    .bind(id)
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
 * Insert a full transcript (metadata + segments) into D1
 */
async function putHistory(db, item) {
  // Insert transcript row
  await db
    .prepare(
      "INSERT OR REPLACE INTO transcripts (id, file_name, created_at, summary, detected_languages, audio_key) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(
      item.id,
      item.file_name,
      item.created_at,
      item.summary || null,
      item.detected_languages ? JSON.stringify(item.detected_languages) : null,
      item.audio_key || null
    )
    .run();

  // Insert segments in a batch
  if (item.segments && item.segments.length > 0) {
    const stmt = db.prepare(
      "INSERT INTO segments (transcript_id, sort_order, speaker, content, start_time, end_time, language, language_code, languages, emotion, translation, words) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );

    // D1 batch supports up to 100 statements at a time
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
 * Update a transcript's segments (e.g. after user edits text/timestamps)
 */
async function updateHistory(db, id, patch) {
  const existing = await getHistory(db, id);
  if (!existing) return null;

  // Update transcript-level fields if provided
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
    binds.push(id);
    await db
      .prepare(`UPDATE transcripts SET ${updates.join(", ")} WHERE id = ?`)
      .bind(...binds)
      .run();
  }

  // If segments are provided, replace them all
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

  return await getHistory(db, id);
}

/**
 * Delete a transcript and its segments (+ R2 audio)
 */
async function deleteHistory(db, bucket, id) {
  // Get audio key before deleting
  const row = await db
    .prepare("SELECT audio_key FROM transcripts WHERE id = ?")
    .bind(id)
    .first();

  // Delete from D1 (CASCADE will remove segments)
  const { meta } = await db
    .prepare("DELETE FROM transcripts WHERE id = ?")
    .bind(id)
    .run();

  // Delete audio from R2
  if (row?.audio_key && bucket) {
    try {
      await bucket.delete(row.audio_key);
    } catch (e) {
      console.error("Failed to delete R2 object:", e);
    }
  }

  return meta.changes > 0;
}

/**
 * Store an audio file in R2 and return the object key
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
 * Retrieve audio from R2
 */
async function getAudio(bucket, key) {
  return await bucket.get(key);
}

/**
 * Log an edit for audit trail
 */
async function logEdit(db, transcriptId, segmentOrder, field, oldValue, newValue) {
  await db
    .prepare(
      "INSERT INTO edits (transcript_id, segment_sort_order, field, old_value, new_value) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(transcriptId, segmentOrder, field, oldValue, newValue)
    .run();
}

export {
  listHistory,
  getHistory,
  putHistory,
  updateHistory,
  deleteHistory,
  storeAudio,
  getAudio,
  logEdit,
};
