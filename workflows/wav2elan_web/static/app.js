// Elements
const uploadZone = document.getElementById("upload-zone");
const fileInput = document.getElementById("file-input");
const folderInput = document.getElementById("folder-input");
const fileList = document.getElementById("file-list");
const historyList = document.getElementById("history-list");
const progressSection = document.getElementById("progress-section");
const progressBarFill = document.getElementById("progress-bar-fill");
const progressMeta = document.getElementById("progress-meta");
const statusBar = document.getElementById("status");
const statusText = statusBar.querySelector(".status-text");
const transcriptEl = document.getElementById("transcript");
const downloadBtn = document.getElementById("download-eaf");
const playerBar = document.getElementById("player-bar");
const audioEl = document.getElementById("audio");
const playPauseBtn = document.getElementById("play-pause");
const iconPlay = playPauseBtn.querySelector(".icon-play");
const iconPause = playPauseBtn.querySelector(".icon-pause");
const currentTimeEl = document.getElementById("current-time");
const durationEl = document.getElementById("duration");
const progressFill = document.getElementById("progress-fill");
const progressInput = document.getElementById("progress-input");

const STEPS = ["loading", "diarizing", "transcribing", "aligning", "done"];
const STEP_COUNT = 4;

let historyCache = new Map();
let historyItems = [];
let activeId = null;
let activeData = null;
let activeWords = [];
let lastWordIndex = 0;
let currentWord = null;
let activeAudioUrl = null;
let editState = null;
let stopAtTime = null;
let stopTimeout = null;
let uploadPlaceholders = [];

uploadZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadZone.classList.add("drag-over");
});

uploadZone.addEventListener("dragleave", () => {
  uploadZone.classList.remove("drag-over");
});

uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadZone.classList.remove("drag-over");
  if (e.dataTransfer.files.length) {
    fileInput.files = e.dataTransfer.files;
    handleFileSelect();
  }
});

fileInput.addEventListener("change", () => handleFileSelect(fileInput.files));
folderInput.addEventListener("change", () => handleFileSelect(folderInput.files));

function handleFileSelect(fileListInput) {
  const files = Array.from(fileListInput || []);
  fileList.innerHTML = "";
  if (!files.length) return;

  files.slice(0, 6).forEach((f) => {
    const chip = document.createElement("span");
    chip.textContent = f.name;
    fileList.appendChild(chip);
  });

  if (files.length > 6) {
    const chip = document.createElement("span");
    chip.textContent = `+${files.length - 6} more`;
    fileList.appendChild(chip);
  }

  uploadFiles(files);
}

function showProgress() {
  progressSection.classList.remove("hidden");
  resetProgress();
}

function hideProgress() {
  progressSection.classList.add("hidden");
}

function resetProgress() {
  const steps = progressSection.querySelectorAll(".progress-step");
  const connectors = progressSection.querySelectorAll(".progress-connector");
  steps.forEach((step) => {
    step.classList.remove("active", "completed");
  });
  connectors.forEach((conn) => {
    conn.classList.remove("filled");
  });
  progressBarFill.style.width = "0%";
  progressMeta.textContent = "";
}

function updateProgress(stepIndex, fileMeta = null) {
  const steps = progressSection.querySelectorAll(".progress-step");
  const connectors = progressSection.querySelectorAll(".progress-connector");

  steps.forEach((step, idx) => {
    step.classList.remove("active", "completed");
    if (idx < stepIndex) {
      step.classList.add("completed");
    } else if (idx === stepIndex) {
      step.classList.add("active");
    }
  });

  connectors.forEach((conn, idx) => {
    conn.classList.remove("filled");
    if (idx < stepIndex) {
      conn.classList.add("filled");
    }
  });

  const pct = Math.min(100, ((stepIndex + 1) / STEP_COUNT) * 100);
  progressBarFill.style.width = `${pct}%`;

  if (fileMeta) {
    progressMeta.textContent = `File ${fileMeta.index + 1}/${fileMeta.count}: ${fileMeta.name}`;
    if (uploadPlaceholders.length && uploadPlaceholders[fileMeta.index]) {
      uploadPlaceholders[fileMeta.index].loadingText = `${fileMeta.name} • ${STEPS[stepIndex]}`;
      renderHistoryList();
    }
  }
}

function showStatus(message, isError = false) {
  statusText.textContent = message;
  statusBar.classList.remove("error");
  if (isError) statusBar.classList.add("error");
  statusBar.classList.add("visible");
}

function hideStatus() {
  statusBar.classList.remove("visible");
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatTimeRange(start, end) {
  return `${start.toFixed(2)}s → ${end.toFixed(2)}s`;
}

function getSpeakerClass(speaker) {
  const num = parseInt(speaker.replace(/\D/g, ""), 10) || 0;
  return `speaker-${num % 3}`;
}

function renderTranscript(data) {
  transcriptEl.innerHTML = "";
  activeData = data;

  data.segments.forEach((segment, segIdx) => {
    const container = document.createElement("div");
    container.className = "segment";
    container.dataset.segment = segIdx;

    const meta = document.createElement("div");
    meta.className = "segment-meta";

    const badge = document.createElement("span");
    badge.className = `speaker-badge ${getSpeakerClass(segment.speaker)}`;
    badge.textContent = segment.speaker;

    const time = document.createElement("span");
    time.className = "segment-time";
    time.textContent = formatTimeRange(segment.start, segment.end);

    meta.appendChild(badge);
    meta.appendChild(time);

    const text = document.createElement("div");
    text.className = "segment-text";

    segment.words.forEach((word, wordIdx) => {
      const span = document.createElement("span");
      span.className = "word";
      span.textContent = word.word;
      span.dataset.start = word.start;
      span.dataset.end = word.end;
      span.dataset.segment = segIdx;
      span.dataset.word = wordIdx;

      span.addEventListener("click", () => {
        playWord(Number(word.start), Number(word.end));
        highlightWord(span);
        openInlineEditor(span);
      });

      text.appendChild(span);
      if (wordIdx < segment.words.length - 1) {
        text.appendChild(document.createTextNode(" "));
      }
    });

    container.appendChild(meta);
    container.appendChild(text);
    transcriptEl.appendChild(container);
  });

  rebuildActiveWords();
}

function highlightWord(wordEl) {
  if (currentWord) {
    currentWord.classList.remove("playing");
  }
  currentWord = wordEl;
  if (currentWord) {
    currentWord.classList.add("playing");
  }
}

audioEl.addEventListener("timeupdate", () => {
  const time = audioEl.currentTime;

  if (audioEl.duration) {
    const pct = (time / audioEl.duration) * 100;
    progressFill.style.width = `${pct}%`;
    progressInput.value = pct;
  }

  currentTimeEl.textContent = formatTime(time);

  if (stopAtTime !== null && time >= stopAtTime) {
    audioEl.pause();
    stopAtTime = null;
  }

  if (!activeWords.length) {
    highlightWord(null);
    return;
  }

  let idx = lastWordIndex;
  if (idx >= activeWords.length) idx = 0;

  let found = null;
  for (let i = idx; i < activeWords.length; i++) {
    const w = activeWords[i];
    if (time >= w.start && time < w.end) {
      found = w.el;
      lastWordIndex = i;
      break;
    }
  }
  if (!found) {
    for (let i = 0; i < idx; i++) {
      const w = activeWords[i];
      if (time >= w.start && time < w.end) {
        found = w.el;
        lastWordIndex = i;
        break;
      }
    }
  }

  if (found !== currentWord) {
    highlightWord(found);
  }
});

audioEl.addEventListener("loadedmetadata", () => {
  durationEl.textContent = formatTime(audioEl.duration);
  progressInput.max = 100;
});

audioEl.addEventListener("play", () => {
  iconPlay.classList.add("hidden");
  iconPause.classList.remove("hidden");
});

audioEl.addEventListener("pause", () => {
  iconPlay.classList.remove("hidden");
  iconPause.classList.add("hidden");
  stopAtTime = null;
  if (stopTimeout) {
    clearTimeout(stopTimeout);
    stopTimeout = null;
  }
});

playPauseBtn.addEventListener("click", () => {
  if (audioEl.paused) {
    audioEl.play();
  } else {
    audioEl.pause();
  }
});

progressInput.addEventListener("input", () => {
  if (audioEl.duration) {
    audioEl.currentTime = (progressInput.value / 100) * audioEl.duration;
  }
});

downloadBtn.addEventListener("click", () => {
  if (!activeData) return;
  const eaf = buildEAF(activeData);
  const blob = new Blob([eaf], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "transcript.eaf";
  a.click();
  URL.revokeObjectURL(url);
});

function buildEAF(data) {
  const escapeXml = (s) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  let tsId = 1;
  const timeSlots = [];
  const annotations = [];
  const speakers = new Set();

  data.segments.forEach((seg, idx) => {
    speakers.add(seg.speaker);
    const ts1 = `ts${tsId++}`;
    const ts2 = `ts${tsId++}`;
    timeSlots.push({ id: ts1, time: Math.round(seg.start * 1000) });
    timeSlots.push({ id: ts2, time: Math.round(seg.end * 1000) });
    annotations.push({
      tier: seg.speaker,
      ts1,
      ts2,
      value: seg.text,
      id: `a${idx + 1}`,
    });
  });

  const tsXml = timeSlots
    .map((ts) => `        <TIME_SLOT TIME_SLOT_ID="${ts.id}" TIME_VALUE="${ts.time}"/>`)
    .join("\n");

  const tiersXml = [...speakers]
    .map((sp) => {
      const tierAnns = annotations
        .filter((a) => a.tier === sp)
        .map(
          (a) =>
            `            <ANNOTATION>
                <ALIGNABLE_ANNOTATION ANNOTATION_ID="${a.id}" TIME_SLOT_REF1="${a.ts1}" TIME_SLOT_REF2="${a.ts2}">
                    <ANNOTATION_VALUE>${escapeXml(a.value)}</ANNOTATION_VALUE>
                </ALIGNABLE_ANNOTATION>
            </ANNOTATION>`
        )
        .join("\n");
      return `        <TIER LINGUISTIC_TYPE_REF="default-lt" TIER_ID="${sp}">
${tierAnns}
        </TIER>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<ANNOTATION_DOCUMENT AUTHOR="Wav2ELAN" DATE="${new Date().toISOString()}" FORMAT="3.0" VERSION="3.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.mpi.nl/tools/elan/EAFv3.0.xsd">
    <HEADER MEDIA_FILE="" TIME_UNITS="milliseconds">
        <MEDIA_DESCRIPTOR MEDIA_URL="${escapeXml(data.audio_url)}" MIME_TYPE="audio/x-wav"/>
    </HEADER>
    <TIME_ORDER>
${tsXml}
    </TIME_ORDER>
${tiersXml}
    <LINGUISTIC_TYPE LINGUISTIC_TYPE_ID="default-lt" TIME_ALIGNABLE="true"/>
</ANNOTATION_DOCUMENT>`;
}

function rebuildActiveWords() {
  activeWords = [];
  const wordEls = transcriptEl.querySelectorAll(".word");
  wordEls.forEach((el) => {
    activeWords.push({
      el,
      start: Number(el.dataset.start),
      end: Number(el.dataset.end),
    });
  });
  activeWords.sort((a, b) => a.start - b.start);
  lastWordIndex = 0;
}

function setActiveHistory(id) {
  activeId = id;
  historyList.querySelectorAll(".history-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.id === id);
  });
}

async function fetchHistory() {
  const res = await fetch("/api/history");
  historyItems = await res.json();
  renderHistoryList();
  if (historyItems.length && !activeId) {
    selectHistory(historyItems[0].id);
  }
}

function renderHistoryList() {
  historyList.innerHTML = "";
  historyItems.forEach((item) => {
    const row = document.createElement("div");
    row.className = "history-item";
    if (item.loading) row.classList.add("loading");
    row.dataset.id = item.id;

    const info = document.createElement("div");
    const name = document.createElement("div");
    name.className = "history-name";
    name.textContent = item.file_name;
    const meta = document.createElement("div");
    meta.className = "history-meta";
    meta.textContent = item.loading
      ? item.loadingText || "Processing…"
      : new Date(item.created_at).toLocaleString();
    info.appendChild(name);
    info.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "history-actions";
    if (item.loading) {
      const spinner = document.createElement("div");
      spinner.className = "history-spinner";
      actions.appendChild(spinner);
    } else {
      actions.appendChild(actionButton("Rename", async (e) => {
        e.stopPropagation();
        const newName = prompt("Rename file", item.file_name);
        if (!newName) return;
        await updateHistory(item.id, { file_name: newName });
        item.file_name = newName;
        renderHistoryList();
      }));
      actions.appendChild(actionButton("Delete", async (e) => {
        e.stopPropagation();
        await deleteHistory(item.id);
        historyItems = historyItems.filter((h) => h.id !== item.id);
        renderHistoryList();
        if (activeId === item.id) {
          activeId = null;
          transcriptEl.innerHTML = "";
          if (historyItems.length) selectHistory(historyItems[0].id);
        }
      }));
    }

    row.appendChild(info);
    row.appendChild(actions);
    if (!item.loading) {
      row.addEventListener("click", () => selectHistory(item.id));
    }
    historyList.appendChild(row);
  });
  setActiveHistory(activeId);
}

function actionButton(label, handler) {
  const btn = document.createElement("button");
  btn.className = "history-btn";
  btn.textContent = label;
  btn.addEventListener("click", handler);
  return btn;
}

async function selectHistory(id) {
  setActiveHistory(id);
  if (historyCache.has(id)) {
    activateTranscript(historyCache.get(id));
    return;
  }
  const res = await fetch(`/api/history/${id}`);
  const data = await res.json();
  historyCache.set(id, data);
  activateTranscript(data);
}

function activateTranscript(data) {
  activeData = data;
  activeAudioUrl = data.audio_url;
  audioEl.src = activeAudioUrl;
  playerBar.classList.add("visible");
  renderTranscript(data);
}

async function updateHistory(id, payload) {
  await fetch(`/api/history/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function deleteHistory(id) {
  await fetch(`/api/history/${id}`, { method: "DELETE" });
}

function openInlineEditor(wordEl) {
  if (!activeData) return;
  const segIdx = Number(wordEl.dataset.segment);
  const wordIdx = Number(wordEl.dataset.word);
  clearWordSelections(wordEl);

  editState = { segIdx, wordIdx, el: wordEl, original: wordEl.textContent };
  wordEl.classList.add("editing");
  wordEl.setAttribute("contenteditable", "true");
  wordEl.focus();
  document.execCommand("selectAll", false, null);
}

async function finalizeInlineEdit(wordEl, restoreOnEmpty = false) {
  if (!editState || !activeData) return;
  const newText = wordEl.textContent.trim();
  if (!newText && restoreOnEmpty) {
    wordEl.textContent = editState.original;
  } else if (newText) {
    const wordData = activeData.segments[editState.segIdx].words[editState.wordIdx];
    wordData.word = newText;
    await updateHistory(activeId, { segments: activeData.segments });
  } else {
    wordEl.textContent = editState.original;
  }
  wordEl.classList.remove("editing");
  wordEl.removeAttribute("contenteditable");
  editState = null;
}

function playWord(start, end) {
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return;
  audioEl.currentTime = start;
  audioEl.play();
  stopAtTime = end;
  if (stopTimeout) clearTimeout(stopTimeout);
  stopTimeout = setTimeout(() => {
    if (!audioEl.paused && audioEl.currentTime >= start) {
      audioEl.pause();
    }
  }, Math.max(0, (end - start) * 1000));
}

function clearWordSelections(activeEl = null) {
  if (editState && editState.el && editState.el !== activeEl) {
    finalizeInlineEdit(editState.el, true);
  }
  document.querySelectorAll(".word.editing").forEach((el) => {
    el.classList.remove("editing");
    el.removeAttribute("contenteditable");
  });
  if (activeEl !== currentWord) {
    highlightWord(activeEl);
  }
}

document.addEventListener("click", (event) => {
  if (!editState) return;
  if (event.target === editState.el) return;
  finalizeInlineEdit(editState.el, true);
});

document.addEventListener("keydown", (event) => {
  if (!editState) return;
  if (event.key === "Enter") {
    event.preventDefault();
    finalizeInlineEdit(editState.el, true);
  }
  if (event.key === "Escape") {
    event.preventDefault();
    if (editState && editState.el) {
      editState.el.textContent = editState.original;
      finalizeInlineEdit(editState.el, true);
    }
  }
});

function shouldUseBatch(files) {
  if (files.length > 1) return true;
  const file = files[0];
  if (!file) return false;
  const lower = file.name.toLowerCase();
  return lower.endsWith(".zip") || !!file.webkitRelativePath;
}

async function uploadFiles(files) {
  hideStatus();
  showProgress();
  resetProgress();

  activeId = null;
  activeData = null;
  activeAudioUrl = null;
  transcriptEl.innerHTML = "";
  audioEl.pause();
  playerBar.classList.remove("visible");

  uploadPlaceholders = files.map((file) => ({
    id: `upload-${crypto.randomUUID()}`,
    file_name: file.name,
    created_at: new Date().toISOString(),
    loading: true,
    loadingText: "Queued…",
  }));
  historyItems = [...uploadPlaceholders, ...historyItems];
  renderHistoryList();

  const formData = new FormData();
  files.forEach((f) => formData.append("files", f));
  if (files.length === 1) {
    formData.delete("files");
    formData.append("file", files[0]);
  }

  try {
    const endpoint = shouldUseBatch(files)
      ? "/api/transcribe-batch-stream"
      : "/api/transcribe-stream";
    const response = await fetch(endpoint, { method: "POST", body: formData });
    if (!response.ok) {
      const body = await response.json();
      throw new Error(body.detail || "Failed to process audio.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let resultData = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      let eventType = null;
      let eventData = null;
      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventType = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          eventData = line.slice(5).trim();
          if (eventType && eventData) {
            const parsed = JSON.parse(eventData);
            if (eventType === "progress") {
              const stepIdx = STEPS.indexOf(parsed.step);
              if (stepIdx >= 0 && stepIdx < STEP_COUNT) {
                updateProgress(stepIdx, {
                  name: parsed.file_name || "Audio",
                  index: parsed.file_index || 0,
                  count: parsed.file_count || 1,
                });
              }
            } else if (eventType === "result") {
              resultData = parsed;
            }
          }
          eventType = null;
          eventData = null;
        }
      }
    }

    updateProgress(STEP_COUNT);
    hideProgress();
    if (resultData) {
      if (resultData.results) {
        historyItems = historyItems.filter((h) => !h.loading);
        resultData.results.forEach((item) => {
          historyCache.set(item.id, item);
        });
        historyItems = [...resultData.results, ...historyItems];
        renderHistoryList();
        if (resultData.results.length) {
          selectHistory(resultData.results[0].id);
        }
      } else {
        historyItems = historyItems.filter((h) => !h.loading);
        historyCache.set(resultData.id, resultData);
        historyItems = [resultData, ...historyItems];
        renderHistoryList();
        selectHistory(resultData.id);
      }
    }
    uploadPlaceholders = [];
  } catch (err) {
    hideProgress();
    showStatus(err.message, true);
    historyItems = historyItems.filter((h) => !h.loading);
    renderHistoryList();
    uploadPlaceholders = [];
  }
}

fetchHistory();
