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
const exportDropdown = document.getElementById("export-dropdown");
const exportBtn = document.getElementById("export-btn");
const exportMenu = document.getElementById("export-menu");
const playerBar = document.getElementById("player-bar");
const audioEl = document.getElementById("audio");
const playPauseBtn = document.getElementById("play-pause");
const iconPlay = playPauseBtn.querySelector(".icon-play");
const iconPause = playPauseBtn.querySelector(".icon-pause");
const currentTimeEl = document.getElementById("current-time");
const durationEl = document.getElementById("duration");
const progressFill = document.getElementById("progress-fill");
const progressInput = document.getElementById("progress-input");

// Gemini-specific elements
const transcriptSummary = document.getElementById("transcript-summary");
const summaryContent = document.getElementById("summary-content");
const languageBadges = document.getElementById("language-badges");

// Canvas header elements
const canvasHeader = document.getElementById("canvas-header");
const canvasName = document.getElementById("canvas-name");
const canvasMeta = document.getElementById("canvas-meta");

// View controls elements
const viewControls = document.getElementById("view-controls");
const highlightModeSelect = document.getElementById("highlight-mode");

// View state
let currentViewMode = "flow"; // "flow" or "box"
let currentHighlightMode = "chunk"; // "chunk", "speaker", "language", "emotion"

// Upload options modal elements
const uploadModal = document.getElementById("upload-modal");
const modalClose = document.getElementById("modal-close");
const modalCancel = document.getElementById("modal-cancel");
const modalConfirm = document.getElementById("modal-confirm");
const languageSelect = document.getElementById("language-select");
const speakerCountSelect = document.getElementById("speaker-count");

// Steps for Gemini API (uploading, transcribing, processing, done)
// Also supports legacy local model steps (loading, diarizing, transcribing, aligning, done)
const GEMINI_STEPS = ["uploading", "transcribing", "processing", "done"];
const LOCAL_STEPS = ["loading", "diarizing", "transcribing", "aligning", "done"];
const STEPS = [...GEMINI_STEPS, ...LOCAL_STEPS]; // Combined for lookup
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

// Audio blob storage - keeps audio in browser memory for playback
// Maps transcript ID -> Blob URL
const audioBlobCache = new Map();

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
    // Direct upload without modal for drop zone
    handleFileSelect(e.dataTransfer.files, false);
  }
});

// Create a separate hidden input for drop zone clicks (no modal)
const dropZoneFileInput = document.createElement("input");
dropZoneFileInput.type = "file";
dropZoneFileInput.multiple = true;
dropZoneFileInput.accept = "audio/*,.zip";
dropZoneFileInput.style.display = "none";
document.body.appendChild(dropZoneFileInput);

dropZoneFileInput.addEventListener("change", () => {
  handleFileSelect(dropZoneFileInput.files, false);
  dropZoneFileInput.value = ""; // Reset for next use
});

// Make drop zone clickable to trigger file upload (without modal)
uploadZone.addEventListener("click", () => {
  dropZoneFileInput.click();
});

// Sidebar buttons show the modal for optional parameters
fileInput.addEventListener("change", () => handleFileSelect(fileInput.files, true));
folderInput.addEventListener("change", () => handleFileSelect(folderInput.files, true));

// Store pending files for upload after modal confirmation
let pendingFiles = [];

function handleFileSelect(fileListInput, showModal = true) {
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

  if (showModal) {
    // Store files and show options modal for sidebar buttons
    pendingFiles = files;
    showUploadModal();
  } else {
    // Direct upload without modal for drop zone
    uploadFiles(files);
  }
}

function showUploadModal() {
  // Reset form values
  languageSelect.value = "";
  speakerCountSelect.value = "";
  uploadModal.classList.remove("hidden");
}

function hideUploadModal() {
  uploadModal.classList.add("hidden");
  pendingFiles = [];
}

function getUploadOptions() {
  return {
    language: languageSelect.value || null,
    speakerCount: speakerCountSelect.value || null,
  };
}

// Modal event handlers
modalClose.addEventListener("click", hideUploadModal);
modalCancel.addEventListener("click", hideUploadModal);

modalConfirm.addEventListener("click", () => {
  const options = getUploadOptions();
  const files = pendingFiles;
  hideUploadModal();
  uploadFiles(files, options);
});

// Close modal on overlay click
uploadModal.addEventListener("click", (e) => {
  if (e.target === uploadModal) {
    hideUploadModal();
  }
});

// Close modal on Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !uploadModal.classList.contains("hidden")) {
    hideUploadModal();
  }
});

// View controls event listeners
document.querySelectorAll(".view-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".view-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentViewMode = btn.dataset.view;
    if (activeData) {
      renderTranscript(activeData);
    }
  });
});

highlightModeSelect.addEventListener("change", () => {
  currentHighlightMode = highlightModeSelect.value;
  if (activeData) {
    renderTranscript(activeData);
  }
});

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

function getStepIndex(stepName) {
  // Map step names from both Gemini and local model to a 0-3 index
  const geminiStepMap = {
    "uploading": 0,
    "transcribing": 1,
    "processing": 2,
    "done": 3
  };
  const localStepMap = {
    "loading": 0,
    "diarizing": 1,
    "transcribing": 2,
    "aligning": 3,
    "done": 3
  };

  if (geminiStepMap[stepName] !== undefined) {
    return geminiStepMap[stepName];
  }
  if (localStepMap[stepName] !== undefined) {
    return localStepMap[stepName];
  }
  return 0;
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
      const stepLabel = GEMINI_STEPS[stepIndex] || STEPS[stepIndex] || "processing";
      uploadPlaceholders[fileMeta.index].loadingText = `${fileMeta.name} • ${stepLabel}`;
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

function getEmotionClass(emotion) {
  const emotionMap = {
    happy: "emotion-happy",
    sad: "emotion-sad",
    angry: "emotion-angry",
    neutral: "emotion-neutral"
  };
  return emotionMap[emotion?.toLowerCase()] || "emotion-neutral";
}

function renderSummary(data) {
  const speakerBadges = document.getElementById("speaker-badges");
  const emotionBadges = document.getElementById("emotion-badges");
  
  if (data.summary || (data.segments && data.segments.length > 0)) {
    transcriptSummary.classList.remove("hidden");
    
    // Strip any metadata lines from summary (in case backend appended them)
    let summaryText = data.summary || "";
    // Remove lines like "5 speakers · emotions: neutral, happy"
    summaryText = summaryText.replace(/\n\n\d+ speakers?.*$/s, "").trim();
    
    summaryContent.textContent = summaryText;
    
    // Clear all badge containers
    languageBadges.innerHTML = "";
    speakerBadges.innerHTML = "";
    emotionBadges.innerHTML = "";
    
    // Collect metadata from segments
    const speakers = new Set();
    const emotions = new Set();
    
    if (data.segments && data.segments.length > 0) {
      data.segments.forEach(seg => {
        if (seg.speaker) speakers.add(seg.speaker);
        if (seg.emotion) emotions.add(seg.emotion);
      });
    }
    
    // Render language badges
    if (data.detected_languages && data.detected_languages.length > 0) {
      data.detected_languages.forEach(lang => {
        const badge = document.createElement("span");
        badge.className = "language-badge";
        badge.textContent = lang.code || lang.language;
        badge.title = lang.language || lang.code;
        languageBadges.appendChild(badge);
      });
    }
    
    // Render speaker count badge
    if (speakers.size > 0) {
      const badge = document.createElement("span");
      badge.className = "summary-badge speaker-badge";
      badge.textContent = `${speakers.size} speaker${speakers.size > 1 ? 's' : ''}`;
      badge.title = [...speakers].join(", ");
      speakerBadges.appendChild(badge);
    }
    
    // Render emotion badges
    if (emotions.size > 0) {
      emotions.forEach(emotion => {
        const badge = document.createElement("span");
        badge.className = `summary-badge emotion-badge emotion-${emotion.toLowerCase()}`;
        badge.textContent = emotion;
        emotionBadges.appendChild(badge);
      });
    }
  } else {
    transcriptSummary.classList.add("hidden");
    summaryContent.textContent = "";
    languageBadges.innerHTML = "";
    speakerBadges.innerHTML = "";
    emotionBadges.innerHTML = "";
  }
}

/**
 * Check if we should show translations (only if non-English languages detected)
 */
function shouldShowTranslations(data) {
  if (!data.detected_languages || data.detected_languages.length === 0) {
    return true; // Show by default if no language info
  }
  // Check if any non-English language is detected
  return data.detected_languages.some(lang => {
    const code = (lang.code || "").toLowerCase();
    const name = (lang.language || "").toLowerCase();
    return !code.startsWith("en") && !name.startsWith("english");
  });
}

// Base color palettes for dynamic assignment
const BASE_PALETTE = [
  [239, 68, 68],    // red
  [249, 115, 22],   // orange
  [234, 179, 8],    // yellow
  [34, 197, 94],    // green
  [6, 182, 212],    // cyan
  [59, 130, 246],   // blue
  [139, 92, 246],   // purple
  [236, 72, 153],   // pink
  [16, 185, 129],   // emerald
  [99, 102, 241],   // indigo
  [168, 85, 247],   // violet
  [244, 63, 94],    // rose
  [20, 184, 166],   // teal
  [245, 158, 11],   // amber
  [132, 204, 22],   // lime
];

// Predefined colors for known languages (optional hints)
const LANGUAGE_COLOR_HINTS = {
  en: [59, 130, 246],
  es: [234, 179, 8],
  fr: [139, 92, 246],
  de: [34, 197, 94],
  zh: [239, 68, 68],
  ja: [236, 72, 153],
  ko: [6, 182, 212],
  ar: [249, 115, 22],
  hi: [168, 85, 247],
  pt: [16, 185, 129],
  ru: [99, 102, 241],
};

// Predefined colors for known emotions
const EMOTION_COLOR_HINTS = {
  happy: [34, 197, 94],
  sad: [59, 130, 246],
  angry: [239, 68, 68],
  neutral: [156, 163, 175],
};

const SPEAKER_COLORS = [
  [61, 107, 153],
  [123, 94, 155],
  [74, 143, 122],
  [196, 93, 62],
  [180, 83, 9],
  [59, 130, 246],
  [234, 179, 8],
  [139, 92, 246],
];

// Dynamic maps built from transcript data
let languageColorMap = new Map();
let emotionColorMap = new Map();

function buildDynamicColorMaps(data) {
  // Reset maps
  languageColorMap = new Map();
  emotionColorMap = new Map();
  
  // Collect unique languages
  const uniqueLanguages = new Set();
  data.segments.forEach(seg => {
    if (seg.languages && Array.isArray(seg.languages) && seg.languages.length > 0) {
      seg.languages.forEach(l => {
        // Handle both {code: "en"} and {name: "English", code: "en"} formats
        const rawCode = (l.code || l.name || "").toLowerCase();
        const code = rawCode.substring(0, 2);
        if (code && code.length > 0) uniqueLanguages.add(code);
      });
    } else if (seg.language_code) {
      const code = seg.language_code.toLowerCase().substring(0, 2);
      if (code) uniqueLanguages.add(code);
    }
  });
  
  // Assign colors to languages
  let langIdx = 0;
  uniqueLanguages.forEach(lang => {
    if (LANGUAGE_COLOR_HINTS[lang]) {
      languageColorMap.set(lang, LANGUAGE_COLOR_HINTS[lang]);
    } else {
      // Dynamic color based on ordinal position
      languageColorMap.set(lang, BASE_PALETTE[langIdx % BASE_PALETTE.length]);
      langIdx++;
    }
  });
  
  // Collect unique emotions
  const uniqueEmotions = new Set();
  data.segments.forEach(seg => {
    if (seg.emotion) {
      uniqueEmotions.add(seg.emotion.toLowerCase());
    }
  });
  
  // Assign colors to emotions
  let emotionIdx = 0;
  uniqueEmotions.forEach(emotion => {
    if (EMOTION_COLOR_HINTS[emotion]) {
      emotionColorMap.set(emotion, EMOTION_COLOR_HINTS[emotion]);
    } else {
      // Dynamic color based on ordinal position
      emotionColorMap.set(emotion, BASE_PALETTE[emotionIdx % BASE_PALETTE.length]);
      emotionIdx++;
    }
  });
}

function getHighlightColor(segment, segIdx, speakerMap) {
  switch (currentHighlightMode) {
    case "chunk":
      const color = BASE_PALETTE[segIdx % BASE_PALETTE.length];
      return `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.15)`;
    
    case "speaker":
      const speakerIdx = speakerMap.get(segment.speaker) || 0;
      const spColor = SPEAKER_COLORS[speakerIdx % SPEAKER_COLORS.length];
      return `rgba(${spColor[0]}, ${spColor[1]}, ${spColor[2]}, 0.2)`;
    
    case "language":
      // Get language color(s) and average if multiple
      let langCodes = [];
      if (segment.languages && Array.isArray(segment.languages) && segment.languages.length > 0) {
        // Extract codes from languages array, filtering out empty values
        langCodes = segment.languages
          .map(l => {
            // Handle both {code: "en"} and {name: "English", code: "en"} formats
            const code = (l.code || l.name || "").toLowerCase();
            return code.substring(0, 2);
          })
          .filter(code => code && code.length > 0);
      }
      
      // Fallback to single language_code if no languages array
      if (langCodes.length === 0 && segment.language_code) {
        langCodes = [segment.language_code.toLowerCase().substring(0, 2)];
      }
      
      if (langCodes.length === 0) {
        return `rgba(156, 163, 175, 0.15)`;
      }
      
      // Remove duplicates
      langCodes = [...new Set(langCodes)];
      
      // Average colors for code-switching
      let r = 0, g = 0, b = 0;
      let validColors = 0;
      langCodes.forEach(code => {
        const lc = languageColorMap.get(code);
        if (lc) {
          r += lc[0];
          g += lc[1];
          b += lc[2];
          validColors++;
        }
      });
      
      // Fallback if no valid colors found
      if (validColors === 0) {
        return `rgba(156, 163, 175, 0.15)`;
      }
      
      r = Math.round(r / validColors);
      g = Math.round(g / validColors);
      b = Math.round(b / validColors);
      return `rgba(${r}, ${g}, ${b}, 0.18)`;
    
    case "emotion":
      const emotion = (segment.emotion || "neutral").toLowerCase();
      const emColor = emotionColorMap.get(emotion) || [156, 163, 175];
      return `rgba(${emColor[0]}, ${emColor[1]}, ${emColor[2]}, 0.2)`;
    
    default:
      return `rgba(156, 163, 175, 0.1)`;
  }
}

function getChunkTooltip(segment, segIdx) {
  const parts = [`#${segIdx + 1}`];
  if (segment.speaker) parts.push(segment.speaker);
  if (segment.languages && Array.isArray(segment.languages) && segment.languages.length > 0) {
    const langs = segment.languages
      .map((lang) => lang.code || lang.name)
      .filter(Boolean);
    if (langs.length > 0) {
      parts.push(langs.join(", "));
    }
  } else if (segment.language_code || segment.language) {
    parts.push(segment.language_code || segment.language);
  }
  if (segment.emotion) parts.push(segment.emotion);
  parts.push(formatTimeRange(segment.start, segment.end));
  return parts.join(" · ");
}

function renderFlowTranscript(data) {
  transcriptEl.innerHTML = "";
  transcriptEl.classList.add("flow-mode");
  transcriptEl.classList.remove("box-mode");
  
  const flowContainer = document.createElement("div");
  flowContainer.className = "flow-container";
  
  // Build speaker map for consistent coloring
  const speakerMap = new Map();
  let speakerIdx = 0;
  data.segments.forEach(seg => {
    if (seg.speaker && !speakerMap.has(seg.speaker)) {
      speakerMap.set(seg.speaker, speakerIdx++);
    }
  });
  
  data.segments.forEach((segment, segIdx) => {
    const chunk = document.createElement("span");
    chunk.className = "flow-chunk";
    chunk.textContent = segment.text;
    chunk.dataset.segment = segIdx;
    chunk.dataset.start = segment.start;
    chunk.dataset.end = segment.end;
    chunk.dataset.tooltip = getChunkTooltip(segment, segIdx);
    
    // Apply highlight color
    chunk.style.backgroundColor = getHighlightColor(segment, segIdx, speakerMap);
    
    chunk.addEventListener("click", () => {
      // Remove active from all chunks
      document.querySelectorAll(".flow-chunk.active").forEach(c => c.classList.remove("active"));
      chunk.classList.add("active");
      playWord(Number(segment.start), Number(segment.end));
    });
    
    flowContainer.appendChild(chunk);
    
    // Add space between chunks
    if (segIdx < data.segments.length - 1) {
      flowContainer.appendChild(document.createTextNode(" "));
    }
  });
  
  transcriptEl.appendChild(flowContainer);
}

function renderBoxTranscript(data) {
  transcriptEl.innerHTML = "";
  transcriptEl.classList.remove("flow-mode");
  transcriptEl.classList.add("box-mode");
  
  const showTranslations = shouldShowTranslations(data);
  
  // Build speaker map for consistent coloring
  const speakerMap = new Map();
  let speakerIdx = 0;
  data.segments.forEach(seg => {
    if (seg.speaker && !speakerMap.has(seg.speaker)) {
      speakerMap.set(seg.speaker, speakerIdx++);
    }
  });

  data.segments.forEach((segment, segIdx) => {
    const container = document.createElement("div");
    container.className = "segment";
    container.dataset.segment = segIdx;
    
    // Apply subtle highlight based on mode
    container.style.borderLeftColor = getHighlightColor(segment, segIdx, speakerMap).replace("0.15", "0.6").replace("0.2", "0.6").replace("0.18", "0.6");
    container.style.borderLeftWidth = "4px";

    const meta = document.createElement("div");
    meta.className = "segment-meta";

    // Speaker badge
    const badge = document.createElement("span");
    badge.className = `speaker-badge ${getSpeakerClass(segment.speaker)}`;
    badge.textContent = segment.speaker;
    meta.appendChild(badge);

    // Language badges (support code-switching with multiple languages)
    if (segment.languages && segment.languages.length > 0) {
      segment.languages.forEach(lang => {
        const langBadge = document.createElement("span");
        langBadge.className = "language-badge";
        langBadge.textContent = lang.code || lang.name;
        langBadge.title = `Language: ${lang.name || lang.code}`;
        meta.appendChild(langBadge);
      });
    } else if (segment.language) {
      const langBadge = document.createElement("span");
      langBadge.className = "language-badge";
      langBadge.textContent = segment.language_code || segment.language;
      langBadge.title = `Language: ${segment.language}`;
      meta.appendChild(langBadge);
    }

    // Emotion indicator (if available)
    if (segment.emotion) {
      const emotionBadge = document.createElement("span");
      emotionBadge.className = `emotion-indicator ${getEmotionClass(segment.emotion)}`;
      emotionBadge.textContent = segment.emotion;
      emotionBadge.title = `Emotion: ${segment.emotion}`;
      meta.appendChild(emotionBadge);
    }

    // Timestamp
    const time = document.createElement("span");
    time.className = "segment-time";
    time.textContent = formatTimeRange(segment.start, segment.end);
    meta.appendChild(time);

    const text = document.createElement("div");
    text.className = "segment-text";

    // Handle word-level display (if words available) or segment-level display
    const words = segment.words || [];
    if (words.length > 0) {
      words.forEach((word, wordIdx) => {
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
        if (wordIdx < words.length - 1) {
          text.appendChild(document.createTextNode(" "));
        }
      });
    } else {
      const span = document.createElement("span");
      span.className = "word segment-text-block";
      span.textContent = segment.text;
      span.dataset.start = segment.start;
      span.dataset.end = segment.end;
      span.dataset.segment = segIdx;
      span.dataset.word = 0;

      span.addEventListener("click", () => {
        playWord(Number(segment.start), Number(segment.end));
        highlightWord(span);
        openInlineEditor(span);
      });

      text.appendChild(span);
    }

    container.appendChild(meta);
    container.appendChild(text);

    // Translation
    const hasValidTranslation = segment.translation && 
      segment.translation !== "null" && 
      segment.translation !== segment.text &&
      segment.translation.trim() !== "";
    if (showTranslations && hasValidTranslation) {
      const translationDiv = document.createElement("div");
      translationDiv.className = "segment-translation";
      translationDiv.textContent = segment.translation;
      container.appendChild(translationDiv);
    }

    transcriptEl.appendChild(container);
  });
}

function renderTranscript(data) {
  activeData = data;

  // Show view controls when we have data
  viewControls.classList.remove("hidden");

  // Build dynamic color maps for languages and emotions
  buildDynamicColorMaps(data);

  // Render summary with language badges
  renderSummary(data);
  
  // Render based on current view mode
  if (currentViewMode === "flow") {
    renderFlowTranscript(data);
  } else {
    renderBoxTranscript(data);
  }

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

// Export dropdown toggle
exportBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  exportDropdown.classList.toggle("open");
  exportMenu.classList.toggle("hidden");
});

// Close dropdown when clicking outside
document.addEventListener("click", (e) => {
  if (!exportDropdown.contains(e.target)) {
    exportDropdown.classList.remove("open");
    exportMenu.classList.add("hidden");
  }
});

// Handle export option clicks
exportMenu.addEventListener("click", (e) => {
  const option = e.target.closest(".export-option");
  if (!option || !activeData) return;
  
  const format = option.dataset.format;
  exportDropdown.classList.remove("open");
  exportMenu.classList.add("hidden");
  
  downloadTranscript(format);
});

function downloadTranscript(format) {
  if (!activeData) return;
  
  let content, mimeType, extension;
  const baseName = activeData.file_name?.replace(/\.[^/.]+$/, "") || "transcript";
  
  switch (format) {
    case "eaf":
      content = buildEAF(activeData);
      mimeType = "application/xml";
      extension = "eaf";
      break;
    case "textgrid":
      content = buildTextGrid(activeData);
      mimeType = "text/plain";
      extension = "TextGrid";
      break;
    case "txt":
      content = buildPlainText(activeData);
      mimeType = "text/plain";
      extension = "txt";
      break;
    case "srt":
      content = buildSRT(activeData);
      mimeType = "text/plain";
      extension = "srt";
      break;
    case "json":
      content = JSON.stringify(activeData, null, 2);
      mimeType = "application/json";
      extension = "json";
      break;
    default:
      return;
  }
  
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${baseName}.${extension}`;
  a.click();
  URL.revokeObjectURL(url);
}

function buildEAF(data) {
  const escapeXml = (s) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  let tsId = 1;
  let annId = 1;
  const timeSlots = [];
  const transcriptAnnotations = [];
  const languageAnnotations = [];
  const emotionAnnotations = [];
  const translationAnnotations = [];
  const speakers = new Set();

  // Check if we have Gemini-specific fields
  const hasLanguage = data.segments.some(seg => seg.language);
  const hasEmotion = data.segments.some(seg => seg.emotion);
  const hasTranslation = data.segments.some(seg => seg.translation && seg.translation !== "null" && seg.translation.trim() !== "");

  data.segments.forEach((seg, idx) => {
    speakers.add(seg.speaker);
    const ts1 = `ts${tsId++}`;
    const ts2 = `ts${tsId++}`;
    timeSlots.push({ id: ts1, time: Math.round(seg.start * 1000) });
    timeSlots.push({ id: ts2, time: Math.round(seg.end * 1000) });

    // Transcript tier
    transcriptAnnotations.push({
      tier: seg.speaker,
      ts1,
      ts2,
      value: seg.text,
      id: `a${annId++}`,
    });

    // Language tier (if available)
    if (seg.language) {
      languageAnnotations.push({
        tier: `${seg.speaker}_language`,
        ts1,
        ts2,
        value: seg.language_code || seg.language,
        id: `a${annId++}`,
      });
    }

    // Emotion tier (if available)
    if (seg.emotion) {
      emotionAnnotations.push({
        tier: `${seg.speaker}_emotion`,
        ts1,
        ts2,
        value: seg.emotion,
        id: `a${annId++}`,
      });
    }

    // Translation tier (if available and valid)
    if (seg.translation && seg.translation !== "null" && seg.translation !== seg.text && seg.translation.trim() !== "") {
      translationAnnotations.push({
        tier: `${seg.speaker}_translation`,
        ts1,
        ts2,
        value: seg.translation,
        id: `a${annId++}`,
      });
    }
  });

  const tsXml = timeSlots
    .map((ts) => `        <TIME_SLOT TIME_SLOT_ID="${ts.id}" TIME_VALUE="${ts.time}"/>`)
    .join("\n");

  // Build transcript tiers
  const transcriptTiersXml = [...speakers]
    .map((sp) => {
      const tierAnns = transcriptAnnotations
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
      return `        <TIER LINGUISTIC_TYPE_REF="transcription" TIER_ID="${sp}">
${tierAnns}
        </TIER>`;
    })
    .join("\n");

  // Build additional tiers for Gemini features
  let additionalTiersXml = "";

  if (hasLanguage) {
    const langTiers = [...speakers]
      .map((sp) => {
        const tierAnns = languageAnnotations
          .filter((a) => a.tier === `${sp}_language`)
          .map(
            (a) =>
              `            <ANNOTATION>
                <ALIGNABLE_ANNOTATION ANNOTATION_ID="${a.id}" TIME_SLOT_REF1="${a.ts1}" TIME_SLOT_REF2="${a.ts2}">
                    <ANNOTATION_VALUE>${escapeXml(a.value)}</ANNOTATION_VALUE>
                </ALIGNABLE_ANNOTATION>
            </ANNOTATION>`
          )
          .join("\n");
        if (!tierAnns) return "";
        return `        <TIER LINGUISTIC_TYPE_REF="language" TIER_ID="${sp}_language">
${tierAnns}
        </TIER>`;
      })
      .filter(Boolean)
      .join("\n");
    additionalTiersXml += langTiers + "\n";
  }

  if (hasEmotion) {
    const emotionTiers = [...speakers]
      .map((sp) => {
        const tierAnns = emotionAnnotations
          .filter((a) => a.tier === `${sp}_emotion`)
          .map(
            (a) =>
              `            <ANNOTATION>
                <ALIGNABLE_ANNOTATION ANNOTATION_ID="${a.id}" TIME_SLOT_REF1="${a.ts1}" TIME_SLOT_REF2="${a.ts2}">
                    <ANNOTATION_VALUE>${escapeXml(a.value)}</ANNOTATION_VALUE>
                </ALIGNABLE_ANNOTATION>
            </ANNOTATION>`
          )
          .join("\n");
        if (!tierAnns) return "";
        return `        <TIER LINGUISTIC_TYPE_REF="emotion" TIER_ID="${sp}_emotion">
${tierAnns}
        </TIER>`;
      })
      .filter(Boolean)
      .join("\n");
    additionalTiersXml += emotionTiers + "\n";
  }

  if (hasTranslation) {
    const translationTiers = [...speakers]
      .map((sp) => {
        const tierAnns = translationAnnotations
          .filter((a) => a.tier === `${sp}_translation`)
          .map(
            (a) =>
              `            <ANNOTATION>
                <ALIGNABLE_ANNOTATION ANNOTATION_ID="${a.id}" TIME_SLOT_REF1="${a.ts1}" TIME_SLOT_REF2="${a.ts2}">
                    <ANNOTATION_VALUE>${escapeXml(a.value)}</ANNOTATION_VALUE>
                </ALIGNABLE_ANNOTATION>
            </ANNOTATION>`
          )
          .join("\n");
        if (!tierAnns) return "";
        return `        <TIER LINGUISTIC_TYPE_REF="translation" TIER_ID="${sp}_translation">
${tierAnns}
        </TIER>`;
      })
      .filter(Boolean)
      .join("\n");
    additionalTiersXml += translationTiers;
  }

  // Build linguistic types
  let linguisticTypes = `    <LINGUISTIC_TYPE LINGUISTIC_TYPE_ID="transcription" TIME_ALIGNABLE="true"/>`;
  if (hasLanguage) {
    linguisticTypes += `\n    <LINGUISTIC_TYPE LINGUISTIC_TYPE_ID="language" TIME_ALIGNABLE="true"/>`;
  }
  if (hasEmotion) {
    linguisticTypes += `\n    <LINGUISTIC_TYPE LINGUISTIC_TYPE_ID="emotion" TIME_ALIGNABLE="true"/>`;
  }
  if (hasTranslation) {
    linguisticTypes += `\n    <LINGUISTIC_TYPE LINGUISTIC_TYPE_ID="translation" TIME_ALIGNABLE="true"/>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<ANNOTATION_DOCUMENT AUTHOR="OmniScribe" DATE="${new Date().toISOString()}" FORMAT="3.0" VERSION="3.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.mpi.nl/tools/elan/EAFv3.0.xsd">
    <HEADER MEDIA_FILE="" TIME_UNITS="milliseconds">
        <MEDIA_DESCRIPTOR MEDIA_URL="${escapeXml(data.audio_url)}" MIME_TYPE="audio/x-wav"/>
    </HEADER>
    <TIME_ORDER>
${tsXml}
    </TIME_ORDER>
${transcriptTiersXml}
${additionalTiersXml}
${linguisticTypes}
</ANNOTATION_DOCUMENT>`;
}

/**
 * Build Praat TextGrid format
 * Supports word-level and segment-level tiers
 */
function buildTextGrid(data) {
  // Calculate total duration from segments
  let maxTime = 0;
  data.segments.forEach(seg => {
    if (seg.end > maxTime) maxTime = seg.end;
  });
  
  // Collect all speakers
  const speakers = [...new Set(data.segments.map(seg => seg.speaker))];
  
  // Build word intervals for each speaker
  const speakerIntervals = {};
  speakers.forEach(sp => {
    speakerIntervals[sp] = [];
  });
  
  // Add segment intervals (with words if available)
  data.segments.forEach(seg => {
    if (seg.words && seg.words.length > 0) {
      // Add each word as an interval
      seg.words.forEach(word => {
        speakerIntervals[seg.speaker].push({
          xmin: word.start,
          xmax: word.end,
          text: word.word
        });
      });
    } else {
      // Add whole segment as single interval
      speakerIntervals[seg.speaker].push({
        xmin: seg.start,
        xmax: seg.end,
        text: seg.text
      });
    }
  });
  
  // Fill gaps with empty intervals and sort
  speakers.forEach(sp => {
    const intervals = speakerIntervals[sp];
    intervals.sort((a, b) => a.xmin - b.xmin);
    
    // Fill gaps
    const filledIntervals = [];
    let lastEnd = 0;
    
    intervals.forEach(interval => {
      if (interval.xmin > lastEnd + 0.001) {
        // Add empty interval for the gap
        filledIntervals.push({
          xmin: lastEnd,
          xmax: interval.xmin,
          text: ""
        });
      }
      filledIntervals.push(interval);
      lastEnd = interval.xmax;
    });
    
    // Add final empty interval if needed
    if (lastEnd < maxTime - 0.001) {
      filledIntervals.push({
        xmin: lastEnd,
        xmax: maxTime,
        text: ""
      });
    }
    
    speakerIntervals[sp] = filledIntervals;
  });
  
  // Build TextGrid format
  const formatTime = (t) => t.toFixed(6);
  const escapeText = (s) => s.replace(/"/g, '""');
  
  let tg = `File type = "ooTextFile"
Object class = "TextGrid"

xmin = 0 
xmax = ${formatTime(maxTime)}

tiers? <exists> 
size = ${speakers.length}
item []:
`;

  speakers.forEach((sp, tierIdx) => {
    const intervals = speakerIntervals[sp];
    
    tg += `    item [${tierIdx + 1}]:
        class = "IntervalTier" 
        name = "${escapeText(sp)}"
        xmin = 0 
        xmax = ${formatTime(maxTime)}
        intervals: size = ${intervals.length}
`;
    
    intervals.forEach((interval, intIdx) => {
      tg += `        intervals [${intIdx + 1}]:
            xmin = ${formatTime(interval.xmin)} 
            xmax = ${formatTime(interval.xmax)}
            text = "${escapeText(interval.text)}"
`;
    });
  });
  
  return tg;
}

/**
 * Build plain text transcript
 */
function buildPlainText(data) {
  const lines = [];
  
  // Add summary if available
  if (data.summary) {
    lines.push("=== Summary ===");
    lines.push(data.summary);
    lines.push("");
  }
  
  // Add detected languages if available
  if (data.detected_languages && data.detected_languages.length > 0) {
    lines.push("=== Detected Languages ===");
    data.detected_languages.forEach(lang => {
      lines.push(`- ${lang.language} (${lang.code})`);
    });
    lines.push("");
  }
  
  lines.push("=== Transcript ===");
  lines.push("");
  
  // Group by speaker for cleaner output
  let currentSpeaker = null;
  
  data.segments.forEach(seg => {
    if (seg.speaker !== currentSpeaker) {
      if (currentSpeaker !== null) lines.push("");
      lines.push(`[${seg.speaker}]`);
      currentSpeaker = seg.speaker;
    }
    
    const timestamp = formatTime(seg.start);
    lines.push(`${timestamp} ${seg.text}`);
    
    // Add translation if available and valid
    if (seg.translation && seg.translation !== "null" && seg.translation !== seg.text && seg.translation.trim() !== "") {
      lines.push(`         → ${seg.translation}`);
    }
  });
  
  return lines.join("\n");
}

/**
 * Build SRT subtitle format
 */
function buildSRT(data) {
  const lines = [];
  let index = 1;
  
  // Format time as HH:MM:SS,mmm (SRT format)
  const formatSrtTime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
  };
  
  data.segments.forEach(seg => {
    lines.push(index.toString());
    lines.push(`${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}`);
    
    // Add speaker prefix if multiple speakers
    const speakers = new Set(data.segments.map(s => s.speaker));
    if (speakers.size > 1) {
      lines.push(`[${seg.speaker}] ${seg.text}`);
    } else {
      lines.push(seg.text);
    }
    
    lines.push("");
    index++;
  });
  
  return lines.join("\n");
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
    info.className = "history-info";
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
      // Three-dot menu button
      const menuBtn = document.createElement("button");
      menuBtn.className = "history-menu-btn";
      menuBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="5" r="2"/>
        <circle cx="12" cy="12" r="2"/>
        <circle cx="12" cy="19" r="2"/>
      </svg>`;
      menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleHistoryMenu(row, item);
      });
      actions.appendChild(menuBtn);
      
      // Dropdown menu (hidden by default)
      const menu = document.createElement("div");
      menu.className = "history-dropdown hidden";
      menu.innerHTML = `
        <button class="history-dropdown-item" data-action="rename">Rename</button>
        <button class="history-dropdown-item danger" data-action="delete">Delete</button>
      `;
      menu.addEventListener("click", async (e) => {
        e.stopPropagation();
        const action = e.target.dataset.action;
        if (action === "rename") {
          const newName = prompt("Rename file", item.file_name);
          if (!newName) return;
          await updateHistory(item.id, { file_name: newName });
          item.file_name = newName;
          renderHistoryList();
        } else if (action === "delete") {
          await deleteHistory(item.id);
          historyItems = historyItems.filter((h) => h.id !== item.id);
          renderHistoryList();
          if (activeId === item.id) {
            activeId = null;
            transcriptEl.innerHTML = "";
            if (historyItems.length) selectHistory(historyItems[0].id);
          }
        }
        closeAllHistoryMenus();
      });
      actions.appendChild(menu);
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

function toggleHistoryMenu(row, item) {
  const menu = row.querySelector(".history-dropdown");
  const wasOpen = !menu.classList.contains("hidden");
  
  // Close all other menus first
  closeAllHistoryMenus();
  
  // Toggle this menu
  if (!wasOpen) {
    menu.classList.remove("hidden");
  }
}

function closeAllHistoryMenus() {
  document.querySelectorAll(".history-dropdown").forEach(m => {
    m.classList.add("hidden");
  });
}

// Close history menus when clicking outside
document.addEventListener("click", (e) => {
  if (!e.target.closest(".history-actions")) {
    closeAllHistoryMenus();
  }
});

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
  
  // Try to get audio URL: prefer blob cache, fall back to server URL
  const blobUrl = audioBlobCache.get(data.id);
  activeAudioUrl = blobUrl || data.audio_url;
  
  if (activeAudioUrl) {
    audioEl.src = activeAudioUrl;
    playerBar.classList.add("visible");
  } else {
    // No audio available - hide player or show disabled state
    audioEl.src = "";
    playerBar.classList.remove("visible");
  }
  
  // Show canvas header with file info
  canvasHeader.classList.remove("hidden");
  canvasName.textContent = data.file_name || "Untitled";
  
  // Show segment count and duration info
  const segmentCount = data.segments?.length || 0;
  const duration = data.segments?.length > 0 
    ? data.segments[data.segments.length - 1].end 
    : 0;
  const durationStr = duration > 0 ? formatTime(duration) : "";
  canvasMeta.textContent = `${segmentCount} segment${segmentCount !== 1 ? 's' : ''}${durationStr ? ' · ' + durationStr : ''}`;
  
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
  // Clean up blob URL if exists
  const blobUrl = audioBlobCache.get(id);
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
    audioBlobCache.delete(id);
  }
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
    const segment = activeData.segments[editState.segIdx];
    // Check if we're editing a word or the whole segment
    if (segment.words && segment.words.length > 0 && segment.words[editState.wordIdx]) {
      // Word-level editing
      segment.words[editState.wordIdx].word = newText;
    } else {
      // Segment-level editing (no words available)
      segment.text = newText;
    }
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

async function uploadFiles(files, options = {}) {
  hideStatus();
  showProgress();
  resetProgress();

  // Don't clear current transcript - just add new canvas to history
  // The user can switch back to the current one via history
  
  // Create blob URLs for audio playback (store in memory)
  // Maps placeholder ID -> { file, blobUrl }
  const pendingAudioBlobs = new Map();
  
  uploadPlaceholders = files.map((file) => {
    const placeholderId = `upload-${crypto.randomUUID()}`;
    // Create blob URL for audio playback
    const blobUrl = URL.createObjectURL(file);
    pendingAudioBlobs.set(file.name, blobUrl);
    return {
      id: placeholderId,
      file_name: file.name,
      created_at: new Date().toISOString(),
      loading: true,
      loadingText: "Queued…",
    };
  });
  historyItems = [...uploadPlaceholders, ...historyItems];
  renderHistoryList();

  const formData = new FormData();
  files.forEach((f) => formData.append("files", f));
  if (files.length === 1) {
    formData.delete("files");
    formData.append("file", files[0]);
  }

  // Add transcription options if provided
  if (options.language) {
    formData.append("language", options.language);
  }
  if (options.speakerCount) {
    formData.append("speaker_count", options.speakerCount);
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
              const stepIdx = getStepIndex(parsed.step);
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
          // Transfer blob URL from pending to permanent cache
          const blobUrl = pendingAudioBlobs.get(item.file_name);
          if (blobUrl) {
            audioBlobCache.set(item.id, blobUrl);
          }
        });
        historyItems = [...resultData.results, ...historyItems];
        renderHistoryList();
        if (resultData.results.length) {
          selectHistory(resultData.results[0].id);
        }
      } else {
        historyItems = historyItems.filter((h) => !h.loading);
        historyCache.set(resultData.id, resultData);
        // Transfer blob URL from pending to permanent cache
        const blobUrl = pendingAudioBlobs.get(resultData.file_name);
        if (blobUrl) {
          audioBlobCache.set(resultData.id, blobUrl);
        }
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
    // Clean up pending blob URLs on error
    pendingAudioBlobs.forEach((url) => URL.revokeObjectURL(url));
    renderHistoryList();
    uploadPlaceholders = [];
  }
}

fetchHistory();
