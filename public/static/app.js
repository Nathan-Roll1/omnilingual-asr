// =============================================
// SESSION KEY — isolates each user's workspace
// =============================================
function generateSessionKey() {
  // 12 chars, alphanumeric, easy to copy/paste
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let key = "";
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  for (const b of arr) key += chars[b % chars.length];
  return key;
}

let sessionKey = localStorage.getItem("omni_session_key");
if (!sessionKey) {
  sessionKey = generateSessionKey();
  localStorage.setItem("omni_session_key", sessionKey);
}

// Attach session key to all fetch requests
const _origFetch = window.fetch;
window.fetch = function (url, opts = {}) {
  // Only add header for our own API calls
  if (typeof url === "string" && url.startsWith("/api/")) {
    opts.headers = opts.headers || {};
    if (opts.headers instanceof Headers) {
      opts.headers.set("x-session-key", sessionKey);
    } else {
      opts.headers["x-session-key"] = sessionKey;
    }
  }
  return _origFetch.call(this, url, opts);
};

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

// Undo stack for text edits: [{segIdx, field, oldValue, newValue}, ...]
const undoStack = [];
let stopAtTime = null;
let stopTimeout = null;
let uploadPlaceholders = [];

// Audio blob storage - keeps audio in browser memory for playback
// Maps transcript ID -> Blob URL
const audioBlobCache = new Map();

// Password protection
const PASSWORD = "sesquip";
let isAuthenticated = sessionStorage.getItem("authenticated") === "true";

// Password modal elements
const passwordModal = document.getElementById("password-modal");
const passwordInput = document.getElementById("password-input");
const passwordSubmit = document.getElementById("password-submit");
const passwordCancel = document.getElementById("password-cancel");
const passwordClose = document.getElementById("password-close");
const passwordError = document.getElementById("password-error");

let pendingAuthCallback = null;

function showPasswordModal(callback) {
  pendingAuthCallback = callback;
  passwordModal.classList.add("visible");
  passwordInput.value = "";
  passwordError.classList.add("hidden");
  passwordInput.focus();
}

function hidePasswordModal() {
  passwordModal.classList.remove("visible");
  pendingAuthCallback = null;
}

function validatePassword() {
  if (passwordInput.value === PASSWORD) {
    isAuthenticated = true;
    sessionStorage.setItem("authenticated", "true");
    // Save callback before hiding modal (which clears it)
    const callback = pendingAuthCallback;
    hidePasswordModal();
    if (callback) {
      callback();
    }
  } else {
    passwordError.classList.remove("hidden");
    passwordInput.value = "";
    passwordInput.focus();
  }
}

if (passwordSubmit) {
  passwordSubmit.addEventListener("click", validatePassword);
}

if (passwordCancel) {
  passwordCancel.addEventListener("click", hidePasswordModal);
}

if (passwordClose) {
  passwordClose.addEventListener("click", hidePasswordModal);
}

if (passwordInput) {
  passwordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      validatePassword();
    }
  });
}

// Gettysburg example - permanent example in library
const GETTYSBURG_EXAMPLE = {
  id: "gettysburg-example",
  file_name: "gettysburg.wav",
  audio_url: "/gettysburg.wav",
  created_at: "2024-01-01T00:00:00.000Z",
  isPermanent: true,
  segments: [
    {
      start: 0,
      end: 10,
      text: "Four score and seven years ago our fathers brought forth on this continent, a new nation, conceived in Liberty, and dedicated to the proposition that all men are created equal.",
      speaker: "Speaker 1"
    }
  ]
};

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

  // Require password authentication
  if (!isAuthenticated) {
    showPasswordModal(() => {
      if (showModal) {
        pendingFiles = files;
        showUploadModal();
      } else {
        uploadFiles(files);
      }
    });
    return;
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
        const langCode = (lang.code || lang.language || "").toLowerCase();
        badge.textContent = lang.code || lang.language;
        badge.title = lang.language || lang.code;
        badge.dataset.lang = langCode;
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

// Colorblind-safe palette (Wong 2011, Nature Methods)
// These 8 colors are distinguishable by all forms of color vision deficiency
const BASE_PALETTE = [
  [0, 114, 178],    // blue
  [230, 159, 0],    // orange
  [0, 158, 115],    // bluish green
  [204, 121, 167],  // reddish purple
  [213, 94, 0],     // vermillion
  [86, 180, 233],   // sky blue
  [240, 228, 66],   // yellow
  [0, 0, 0],        // black (for maximum contrast)
  [100, 143, 255],  // periwinkle
  [120, 94, 240],   // indigo
  [254, 97, 0],     // tangerine
  [0, 191, 179],    // teal
];

// Colorblind-safe language color hints
const LANGUAGE_COLOR_HINTS = {
  en: [0, 114, 178],     // blue
  es: [230, 159, 0],     // orange
  fr: [204, 121, 167],   // reddish purple
  de: [0, 158, 115],     // bluish green
  zh: [213, 94, 0],      // vermillion
  ja: [86, 180, 233],    // sky blue
  ko: [0, 191, 179],     // teal
  ar: [230, 159, 0],     // orange
  hi: [204, 121, 167],   // reddish purple
  pt: [0, 158, 115],     // bluish green
  ru: [100, 143, 255],   // periwinkle
};

// Colorblind-safe emotion colors
const EMOTION_COLOR_HINTS = {
  happy: [0, 158, 115],    // bluish green
  sad: [0, 114, 178],      // blue
  angry: [213, 94, 0],     // vermillion
  neutral: [154, 154, 154], // grey
};

// Colorblind-safe speaker colors (Wong 2011)
const SPEAKER_COLORS = [
  [0, 114, 178],     // blue
  [213, 94, 0],      // vermillion
  [0, 158, 115],     // bluish green
  [204, 121, 167],   // reddish purple
  [230, 159, 0],     // orange
  [86, 180, 233],    // sky blue
  [240, 228, 66],    // yellow
  [120, 94, 240],    // indigo
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
    
    chunk.addEventListener("click", (e) => {
      e.stopPropagation();
      // If already editing this chunk, let the native click position the cursor
      if (editState && editState.el === chunk) return;
      // Remove active from all chunks
      document.querySelectorAll(".flow-chunk.active").forEach(c => c.classList.remove("active"));
      chunk.classList.add("active");
      playWord(Number(segment.start), Number(segment.end));
      // Open inline editor on single click
      if (editState) finalizeInlineEdit(editState.el, true);
      chunk.dataset.word = "0"; // flow chunks are whole segments
      openInlineEditor(chunk);
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
        const langCode = (lang.code || lang.name || "").toLowerCase();
        langBadge.textContent = lang.code || lang.name;
        langBadge.title = `Language: ${lang.name || lang.code}`;
        langBadge.dataset.lang = langCode;
        meta.appendChild(langBadge);
      });
    } else if (segment.language) {
      const langBadge = document.createElement("span");
      langBadge.className = "language-badge";
      const langCode = (segment.language_code || segment.language || "").toLowerCase();
      langBadge.textContent = segment.language_code || segment.language;
      langBadge.title = `Language: ${segment.language}`;
      langBadge.dataset.lang = langCode;
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
          // If already editing this word, let the native click position the cursor
          if (editState && editState.el === span) return;
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
        // If already editing this segment, let the native click position the cursor
        if (editState && editState.el === span) return;
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
  playPauseBtn.blur(); // Release focus so spacebar works globally
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
<ANNOTATION_DOCUMENT AUTHOR="OmniTranscribe" DATE="${new Date().toISOString()}" FORMAT="3.0" VERSION="3.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.mpi.nl/tools/elan/EAFv3.0.xsd">
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
  let items = await res.json();
  
  // Add permanent gettysburg example at the beginning
  if (!items.find(item => item.id === GETTYSBURG_EXAMPLE.id)) {
    items = [GETTYSBURG_EXAMPLE, ...items];
  }
  
  historyItems = items;
  renderHistoryList();
  
  // Auto-load gettysburg example on first visit so users can test
  if (!activeId) {
    selectHistory(GETTYSBURG_EXAMPLE.id);
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
      // Don't show delete option for permanent examples
      if (item.isPermanent) {
        menu.innerHTML = `
          <button class="history-dropdown-item" data-action="info">Example file</button>
        `;
      } else {
        menu.innerHTML = `
          <button class="history-dropdown-item" data-action="rename">Rename</button>
          <button class="history-dropdown-item danger" data-action="delete">Delete</button>
        `;
      }
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
  if (!id) {
    console.error("selectHistory called with invalid id:", id);
    return;
  }
  
  setActiveHistory(id);
  
  // Handle permanent gettysburg example
  if (id === GETTYSBURG_EXAMPLE.id) {
    await activateTranscript(GETTYSBURG_EXAMPLE);
    return;
  }
  
  if (historyCache.has(id)) {
    await activateTranscript(historyCache.get(id));
    return;
  }
  
  try {
    const res = await fetch(`/api/history/${id}`);
    if (!res.ok) {
      console.error("Failed to fetch history:", res.status);
      return;
    }
    const data = await res.json();
    if (!data || !data.id) {
      console.error("Invalid history data:", data);
      return;
    }
    historyCache.set(id, data);
    await activateTranscript(data);
  } catch (err) {
    console.error("Error fetching history:", err);
  }
}

async function activateTranscript(data) {
  if (!data) {
    console.error("activateTranscript called with invalid data");
    return;
  }
  
  activeData = data;
  
  // Try to get audio URL: prefer blob cache, otherwise fetch via JS to include session key
  let blobUrl = audioBlobCache.get(data.id);
  if (!blobUrl && data.audio_url) {
    try {
      const resp = await fetch(data.audio_url);
      if (resp.ok) {
        const blob = await resp.blob();
        blobUrl = URL.createObjectURL(blob);
        audioBlobCache.set(data.id, blobUrl);
      }
    } catch (e) {
      console.warn("Failed to fetch audio:", e);
    }
  }
  activeAudioUrl = blobUrl || null;
  
  if (activeAudioUrl) {
    audioEl.src = activeAudioUrl;
    playerBar.classList.add("visible");
    
    // Reset audio source connection when switching tracks
    audioSource = null;
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
  } else if (newText && newText !== editState.original) {
    const segment = activeData.segments[editState.segIdx];
    // Check if we're editing a word or the whole segment
    if (segment.words && segment.words.length > 0 && segment.words[editState.wordIdx]) {
      // Word-level editing
      undoStack.push({ segIdx: editState.segIdx, field: "word", wordIdx: editState.wordIdx, oldValue: editState.original, newValue: newText });
      segment.words[editState.wordIdx].word = newText;
    } else {
      // Segment-level editing (flow or no words)
      undoStack.push({ segIdx: editState.segIdx, field: "text", oldValue: editState.original, newValue: newText });
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
  // Ctrl+Z / Cmd+Z undo
  if ((event.ctrlKey || event.metaKey) && event.key === "z" && !editState) {
    event.preventDefault();
    performUndo();
    return;
  }

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

async function performUndo() {
  if (!undoStack.length || !activeData || !activeId) return;
  const action = undoStack.pop();
  const segment = activeData.segments[action.segIdx];
  if (!segment) return;

  if (action.field === "word" && segment.words && segment.words[action.wordIdx]) {
    segment.words[action.wordIdx].word = action.oldValue;
  } else if (action.field === "text") {
    segment.text = action.oldValue;
  }

  await updateHistory(activeId, { segments: activeData.segments });
  renderTranscript(activeData);
}

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

  // Clear the current transcript view to show a clean "uploading" state
  activeId = null;
  activeData = null;
  transcriptEl.innerHTML = "";
  transcriptSummary.classList.add("hidden");
  viewControls.classList.add("hidden");
  canvasHeader.classList.add("hidden");
  playerBar.classList.remove("visible");
  
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
    // Persist across read() chunks so split event:/data: lines still pair up
    let eventType = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          // Blank line = SSE message boundary; reset for next message
          eventType = null;
          continue;
        }
        if (trimmed.startsWith("event:")) {
          eventType = trimmed.slice(6).trim();
        } else if (trimmed.startsWith("data:")) {
          const eventData = trimmed.slice(5).trim();
          if (eventType && eventData) {
            try {
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
              } else if (eventType === "error") {
                throw new Error(parsed.message || "Transcription failed.");
              }
            } catch (parseErr) {
              if (parseErr instanceof SyntaxError) {
                console.error("SSE JSON parse error:", parseErr, eventData.slice(0, 200));
              } else {
                throw parseErr;
              }
            }
          }
          eventType = null;
        }
      }
    }

    updateProgress(STEP_COUNT);
    hideProgress();

    // Always clean up loading placeholders
    historyItems = historyItems.filter((h) => !h.loading);

    if (resultData) {
      if (resultData.results) {
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
          await selectHistory(resultData.results[0].id);
        }
      } else {
        historyCache.set(resultData.id, resultData);
        // Transfer blob URL from pending to permanent cache
        const blobUrl = pendingAudioBlobs.get(resultData.file_name);
        if (blobUrl) {
          audioBlobCache.set(resultData.id, blobUrl);
        }
        historyItems = [resultData, ...historyItems];
        renderHistoryList();
        await selectHistory(resultData.id);
      }
    } else {
      // No result received — show error and clean up
      renderHistoryList();
      showStatus("No transcription result received. Please try again.", true);
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

// Citation toggle and copy
const citeBtn = document.getElementById("cite-btn");
const citeBox = document.getElementById("cite-box");
const citeCopy = document.getElementById("cite-copy");
const citeText = document.getElementById("cite-text");

if (citeBtn && citeBox) {
  citeBtn.addEventListener("click", () => {
    citeBox.classList.toggle("hidden");
  });
}

if (citeCopy && citeText) {
  citeCopy.addEventListener("click", async () => {
    // Get plain text version (without HTML tags)
    const plainText = 'Roll, Nathan, Lorena Martin Rodriguez, and Dan Jurafsky. OmniTranscribe. Stanford Linguistics, 2025. Web.';
    
    try {
      await navigator.clipboard.writeText(plainText);
      citeCopy.textContent = "Copied!";
      citeCopy.classList.add("copied");
      setTimeout(() => {
        citeCopy.textContent = "Copy";
        citeCopy.classList.remove("copied");
      }, 2000);
    } catch (err) {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = plainText;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      citeCopy.textContent = "Copied!";
      citeCopy.classList.add("copied");
      setTimeout(() => {
        citeCopy.textContent = "Copy";
        citeCopy.classList.remove("copied");
      }, 2000);
    }
  });
}

// =============================================
// SESSION KEY UI
// =============================================
const sessionKeyEl = document.getElementById("session-key-value");
const sessionCopyBtn = document.getElementById("session-copy");
const sessionRestoreBtn = document.getElementById("session-restore");
const sessionRestoreInput = document.getElementById("session-restore-input");
const sessionRestoreBox = document.getElementById("session-restore-box");
const sessionRestoreConfirm = document.getElementById("session-restore-confirm");
const sessionRestoreCancel = document.getElementById("session-restore-cancel");

if (sessionKeyEl) {
  sessionKeyEl.textContent = sessionKey;
}

if (sessionCopyBtn) {
  sessionCopyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(sessionKey);
      sessionCopyBtn.textContent = "Copied!";
      sessionCopyBtn.classList.add("copied");
      setTimeout(() => {
        sessionCopyBtn.textContent = "Copy";
        sessionCopyBtn.classList.remove("copied");
      }, 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = sessionKey;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      sessionCopyBtn.textContent = "Copied!";
      sessionCopyBtn.classList.add("copied");
      setTimeout(() => {
        sessionCopyBtn.textContent = "Copy";
        sessionCopyBtn.classList.remove("copied");
      }, 2000);
    }
  });
}

if (sessionRestoreBtn && sessionRestoreBox) {
  sessionRestoreBtn.addEventListener("click", () => {
    sessionRestoreBox.classList.toggle("hidden");
    if (!sessionRestoreBox.classList.contains("hidden") && sessionRestoreInput) {
      sessionRestoreInput.value = "";
      sessionRestoreInput.focus();
    }
  });
}

if (sessionRestoreConfirm && sessionRestoreInput) {
  sessionRestoreConfirm.addEventListener("click", () => {
    const newKey = sessionRestoreInput.value.trim();
    if (newKey && newKey.length >= 8) {
      localStorage.setItem("omni_session_key", newKey);
      sessionKey = newKey;
      window.location.reload();
    } else {
      sessionRestoreInput.style.borderColor = "#b91c1c";
      setTimeout(() => { sessionRestoreInput.style.borderColor = ""; }, 1500);
    }
  });

  sessionRestoreInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sessionRestoreConfirm.click();
  });
}

if (sessionRestoreCancel && sessionRestoreBox) {
  sessionRestoreCancel.addEventListener("click", () => {
    sessionRestoreBox.classList.add("hidden");
  });
}

fetchHistory();

// =============================================
// WAVEFORM/SPECTROGRAM VISUALIZATION
// =============================================

const waveformPanel = document.getElementById("waveform-panel");
const waveformCanvas = document.getElementById("waveform-canvas");
const spectrogramCanvas = document.getElementById("spectrogram-canvas");
const waveformPlayhead = document.getElementById("waveform-playhead");
const waveformSegments = document.getElementById("waveform-segments");
const waveformTimeRuler = document.getElementById("waveform-time-ruler");
const waveformCanvasContainer = document.querySelector(".waveform-canvas-container");
const toggleWaveformBtn = document.getElementById("toggle-waveform");
const tabWaveform = document.getElementById("tab-waveform");
const tabSpectrogram = document.getElementById("tab-spectrogram");
const zoomInBtn = document.getElementById("zoom-in");
const zoomOutBtn = document.getElementById("zoom-out");
const waveformCloseBtn = document.getElementById("waveform-close");

let audioContext = null;
let analyser = null;
let audioSource = null;
let waveformCtx = null;
let spectrogramCtx = null;
let isWaveformVisible = false;
let currentWaveformView = "waveform"; // "waveform" or "spectrogram"
let waveformZoom = 1; // zoom multiplier (1 = fit to width)
let waveformScrollOffset = 0; // horizontal scroll offset in pixels
let waveformData = null; // pre-computed waveform peaks
let spectrogramData = []; // rolling spectrogram data
let animationFrameId = null;

// Initialize canvas contexts
if (waveformCanvas) {
  waveformCtx = waveformCanvas.getContext("2d");
}
if (spectrogramCanvas) {
  // Use willReadFrequently to optimize frequent pixel operations
  spectrogramCtx = spectrogramCanvas.getContext("2d", { willReadFrequently: true });
  if (spectrogramCtx) {
    spectrogramCtx.imageSmoothingEnabled = false;
  }
}

function initAudioContext() {
  if (audioContext) return;

  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
  } catch (err) {
    console.warn("Web Audio API not supported:", err);
  }
}

function ensureAudioSource() {
  if (!audioContext) {
    initAudioContext();
  }
  if (!audioContext || !analyser) return;

  if (audioContext.state === "suspended") {
    audioContext.resume();
  }

  if (!audioSource && audioEl.src) {
    try {
      audioEl.crossOrigin = "anonymous";
      audioSource = audioContext.createMediaElementSource(audioEl);
      audioSource.connect(analyser);
      analyser.connect(audioContext.destination);
    } catch (err) {
      console.warn("Could not connect audio source:", err);
    }
  }
}

function toggleWaveformPanel() {
  isWaveformVisible = !isWaveformVisible;
  waveformPanel.classList.toggle("visible", isWaveformVisible);
  toggleWaveformBtn.setAttribute("aria-pressed", isWaveformVisible);
  
  if (isWaveformVisible) {
    ensureAudioSource();
    resizeWaveformCanvas();
    computeWaveformData();
    startVisualization();
    renderSegmentsOnWaveform();
    updateTimeRuler();
  } else {
    stopVisualization();
  }
}

function resizeWaveformCanvas() {
  if (!waveformCanvas || !spectrogramCanvas) return;
  
  const container = document.getElementById("waveform-split-container") || waveformCanvas.parentElement;
  const rect = container.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  
  waveformCanvas.width = rect.width * dpr;
  waveformCanvas.height = rect.height * dpr;
  waveformCanvas.style.width = `${rect.width}px`;
  waveformCanvas.style.height = `${rect.height}px`;
  if (waveformCtx) {
    waveformCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  spectrogramCanvas.width = rect.width * dpr;
  spectrogramCanvas.height = rect.height * dpr;
  spectrogramCanvas.style.width = `${rect.width}px`;
  spectrogramCanvas.style.height = `${rect.height}px`;
  // Note: Spectrogram uses raw pixel coordinates (no transform) for ImageData operations
  // The DPR is handled in computeSpectrogram() by using canvas.width directly
  if (spectrogramCtx) {
    spectrogramCtx.setTransform(1, 0, 0, 1, 0, 0);
  }
}

let audioBufferCache = null; // Cache decoded audio buffer

async function computeWaveformData() {
  if (!audioEl.src || !audioEl.duration) return;
  
  try {
    // Use cached audio buffer if available
    if (!audioBufferCache) {
      const response = await fetch(audioEl.src);
      const arrayBuffer = await response.arrayBuffer();
      const tempContext = new (window.AudioContext || window.webkitAudioContext)();
      audioBufferCache = await tempContext.decodeAudioData(arrayBuffer);
      tempContext.close();
    }
    
    const channelData = audioBufferCache.getChannelData(0);
    const samples = channelData.length;
    const canvas = waveformCanvas;
    const baseWidth = canvas.width / (window.devicePixelRatio || 1);
    
    // Apply zoom level - more zoom = more detail (fewer samples per pixel)
    const zoomedWidth = Math.floor(baseWidth * waveformZoom);
    const samplesPerPixel = Math.floor(samples / zoomedWidth);
    
    waveformData = [];
    for (let i = 0; i < zoomedWidth; i++) {
      let min = 1.0;
      let max = -1.0;
      const start = i * samplesPerPixel;
      const end = Math.min(start + samplesPerPixel, samples);
      
      for (let j = start; j < end; j++) {
        const sample = channelData[j];
        if (sample < min) min = sample;
        if (sample > max) max = sample;
      }
      
      waveformData.push({ min, max });
    }
    
    drawWaveform();
  } catch (err) {
    console.warn("Could not compute waveform:", err);
  }
}

// Clear audio buffer cache and reset zoom when audio source changes
audioEl.addEventListener("emptied", () => {
  audioBufferCache = null;
  waveformZoom = 1;
  waveformScrollOffset = 0;
  waveformData = null;
});

function drawWaveform() {
  if (!waveformCtx || !waveformData) return;
  
  const canvas = waveformCanvas;
  const canvasWidth = canvas.width / (window.devicePixelRatio || 1);
  const height = canvas.height / (window.devicePixelRatio || 1) - 24; // Account for time ruler
  const centerY = height / 2;
  
  // Calculate visible range based on zoom and scroll
  const totalWidth = waveformData.length;
  
  // Auto-center on playhead when zoomed AND playing
  // Only auto-scroll when audio is playing to allow manual scroll when paused
  if (waveformZoom > 1 && audioEl.duration && !audioEl.paused) {
    const playheadPosition = (audioEl.currentTime / audioEl.duration) * totalWidth;
    const visibleRange = canvasWidth;
    waveformScrollOffset = Math.max(0, Math.min(playheadPosition - visibleRange / 2, totalWidth - visibleRange));
  } else if (waveformZoom <= 1) {
    waveformScrollOffset = 0;
  }
  // When paused, preserve the current waveformScrollOffset for manual scrolling
  
  waveformCtx.clearRect(0, 0, canvasWidth, height + 24);
  
  // Draw background gradient
  const gradient = waveformCtx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#1a1a2e");
  gradient.addColorStop(1, "#16213e");
  waveformCtx.fillStyle = gradient;
  waveformCtx.fillRect(0, 0, canvasWidth, height);
  
  // Draw center line
  waveformCtx.strokeStyle = "rgba(255, 255, 255, 0.1)";
  waveformCtx.lineWidth = 1;
  waveformCtx.beginPath();
  waveformCtx.moveTo(0, centerY);
  waveformCtx.lineTo(canvasWidth, centerY);
  waveformCtx.stroke();
  
  // Draw waveform
  const waveGradient = waveformCtx.createLinearGradient(0, 0, 0, height);
  waveGradient.addColorStop(0, "#8c1515");
  waveGradient.addColorStop(0.5, "#b31b1b");
  waveGradient.addColorStop(1, "#8c1515");
  waveformCtx.fillStyle = waveGradient;
  
  // Draw visible portion of waveform
  const startIdx = Math.floor(waveformScrollOffset);
  const endIdx = Math.min(startIdx + Math.ceil(canvasWidth), waveformData.length);
  
  for (let i = startIdx; i < endIdx; i++) {
    const peak = waveformData[i];
    const x = i - waveformScrollOffset;
    const minY = centerY + peak.min * centerY * 0.9;
    const maxY = centerY + peak.max * centerY * 0.9;
    const barHeight = Math.max(1, maxY - minY);
    waveformCtx.fillRect(x, minY, 1, barHeight);
  }
  
  // Draw played region overlay
  if (audioEl.duration) {
    const playheadPosition = (audioEl.currentTime / audioEl.duration) * totalWidth;
    const playedWidth = playheadPosition - waveformScrollOffset;
    if (playedWidth > 0) {
      waveformCtx.fillStyle = "rgba(140, 21, 21, 0.3)";
      waveformCtx.fillRect(0, 0, Math.min(playedWidth, canvasWidth), height);
    }
  }
  
  // Show zoom level indicator if zoomed
  if (waveformZoom > 1) {
    waveformCtx.fillStyle = "rgba(255, 255, 255, 0.7)";
    waveformCtx.font = "11px system-ui, sans-serif";
    waveformCtx.fillText(`${waveformZoom.toFixed(1)}x zoom`, 8, 16);
  }
}

// Simple FFT implementation for static spectrogram
const FFT = {
  // Cooley-Tukey radix-2
  fft: function(real, imag) {
    const n = real.length;
    if (n <= 1) return;

    const half = n / 2;
    const evenReal = new Float32Array(half);
    const evenImag = new Float32Array(half);
    const oddReal = new Float32Array(half);
    const oddImag = new Float32Array(half);

    for (let i = 0; i < half; i++) {
      evenReal[i] = real[2 * i];
      evenImag[i] = imag[2 * i];
      oddReal[i] = real[2 * i + 1];
      oddImag[i] = imag[2 * i + 1];
    }

    this.fft(evenReal, evenImag);
    this.fft(oddReal, oddImag);

    for (let k = 0; k < half; k++) {
      const angle = -2 * Math.PI * k / n;
      const wReal = Math.cos(angle);
      const wImag = Math.sin(angle);
      
      const tReal = wReal * oddReal[k] - wImag * oddImag[k];
      const tImag = wReal * oddImag[k] + wImag * oddReal[k];
      
      real[k] = evenReal[k] + tReal;
      imag[k] = evenImag[k] + tImag;
      real[k + half] = evenReal[k] - tReal;
      imag[k + half] = evenImag[k] - tImag;
    }
  },

  // Compute magnitude spectrum from time domain data
  computeSpectrum: function(timeData, windowSize) {
    const n = windowSize;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    
    // Apply Hanning window
    for (let i = 0; i < n; i++) {
      const window = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
      real[i] = (timeData[i] || 0) * window;
    }
    
    this.fft(real, imag);
    
    // Compute magnitude (only first half is needed)
    const spectrum = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      spectrum[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
    }
    
    return spectrum;
  }
};

async function computeSpectrogram() {
  if (!audioEl.duration || !spectrogramCtx) return;
  
  // Ensure we have audio buffer
  if (!audioBufferCache) {
    if (audioEl.src) {
      try {
        const response = await fetch(audioEl.src);
        const arrayBuffer = await response.arrayBuffer();
        const tempContext = new (window.AudioContext || window.webkitAudioContext)();
        audioBufferCache = await tempContext.decodeAudioData(arrayBuffer);
        tempContext.close();
      } catch (e) {
        console.warn("Failed to decode audio for spectrogram", e);
        return;
      }
    } else {
      return;
    }
  }

  const canvas = spectrogramCanvas;
  const width = canvas.width; // Actual pixel width (dpr adjusted)
  const height = canvas.height;
  
  // Clear canvas
  spectrogramCtx.fillStyle = "#000";
  spectrogramCtx.fillRect(0, 0, width, height);

  const channelData = audioBufferCache.getChannelData(0);
  const sampleRate = audioBufferCache.sampleRate;
  const totalSamples = channelData.length;
  
  // FFT parameters
  const fftSize = 512; // Lower resolution for speed, but acceptable for visual
  const frequencyBinCount = fftSize / 2;
  
  // Calculate visible range
  let startSample = 0;
  let endSample = totalSamples;
  
  if (waveformZoom > 1 && waveformData) {
    // waveformData.length is already zoomed (baseWidth * waveformZoom)
    // So we need to calculate visible time range properly
    const totalWaveformPoints = waveformData.length;
    const duration = audioEl.duration;
    const dpr = window.devicePixelRatio || 1;
    const canvasWidthLogical = canvas.width / dpr;
    
    // Calculate visible time range
    const visibleStartTime = (waveformScrollOffset / totalWaveformPoints) * duration;
    const visibleEndTime = ((waveformScrollOffset + canvasWidthLogical) / totalWaveformPoints) * duration;
    
    startSample = Math.floor(visibleStartTime * sampleRate);
    endSample = Math.floor(visibleEndTime * sampleRate);
  }
  
  // Clamp
  startSample = Math.max(0, startSample);
  endSample = Math.min(totalSamples, endSample);
  
  const samplesPerPixel = (endSample - startSample) / width;
  
  // Offscreen rendering for performance
  const imageData = spectrogramCtx.createImageData(width, height);
  const data = imageData.data;
  
  // Generate spectrogram columns
  // We skip pixels to keep it fast if needed, but 1px resolution is best
  for (let x = 0; x < width; x++) {
    const centerSample = Math.floor(startSample + x * samplesPerPixel);
    
    // Extract window
    const windowStart = centerSample - fftSize / 2;
    const timeSlice = new Float32Array(fftSize);
    
    for (let i = 0; i < fftSize; i++) {
      const idx = windowStart + i;
      if (idx >= 0 && idx < totalSamples) {
        timeSlice[i] = channelData[idx];
      }
    }
    
    const spectrum = FFT.computeSpectrum(timeSlice, fftSize);
    
    // Map spectrum to pixels (y-axis)
    // Logarithmic frequency scale looks better usually, but linear is standard for simple views
    // Let's do linear for simplicity first, or simple log mapping
    
    for (let y = 0; y < height; y++) {
      // Linear freq mapping: 0 to Nyquist
      // Flip y (0 is top) and map full height to full bin range
      const normalizedY = height > 1 ? y / (height - 1) : 0;
      const freqIndex = Math.floor((1 - normalizedY) * (frequencyBinCount - 1));
      const magnitude = spectrum[freqIndex] || 0;
      
      // Log magnitude for visibility
      const intensity = Math.log10(magnitude * 100 + 1) * 60; // Scaling factor
      const normalized = Math.min(1, Math.max(0, intensity / 100));
      
      // Heatmap colors
      let r, g, b;
      if (normalized < 0.2) {
        r = 0; g = 0; b = Math.floor(normalized * 5 * 255);
      } else if (normalized < 0.5) {
        const t = (normalized - 0.2) / 0.3;
        r = Math.floor(180 * t);
        g = Math.floor(30 * t);
        b = Math.floor(30 * t);
      } else {
        const t = (normalized - 0.5) / 0.5;
        r = 180 + Math.floor(75 * t);
        g = 30 + Math.floor(225 * t);
        b = 30; // Yellowish
      }
      
      const pixelIndex = (y * width + x) * 4;
      data[pixelIndex] = r;
      data[pixelIndex + 1] = g;
      data[pixelIndex + 2] = b;
      data[pixelIndex + 3] = 255;
    }
  }
  
  spectrogramCtx.putImageData(imageData, 0, 0);
}

// Replaces the real-time drawSpectrogram
function drawSpectrogram() {
  // No-op for loop, handled by computeSpectrogram
}

function updatePlayhead() {
  if (!audioEl.duration || !waveformPlayhead) return;
  
  const container = document.getElementById("waveform-split-container") || waveformCanvas.parentElement;
  const canvasWidth = container.offsetWidth;
  
  if (waveformZoom > 1 && waveformData) {
    // When zoomed, playhead position is relative to visible area
    const totalWidth = waveformData.length;
    const playheadInData = (audioEl.currentTime / audioEl.duration) * totalWidth;
    const position = playheadInData - waveformScrollOffset;
    waveformPlayhead.style.left = `${position}px`;
    // Hide playhead if outside visible area
    waveformPlayhead.style.display = (position < 0 || position > canvasWidth) ? "none" : "block";
  } else {
    const position = (audioEl.currentTime / audioEl.duration) * canvasWidth;
    waveformPlayhead.style.left = `${position}px`;
    waveformPlayhead.style.display = "block";
  }
}

function updateTimeRuler() {
  if (!waveformTimeRuler || !audioEl.duration) return;
  
  waveformTimeRuler.innerHTML = "";
  const container = document.getElementById("waveform-split-container") || waveformCanvas.parentElement;
  const canvasWidth = container.offsetWidth;
  const duration = audioEl.duration;
  
  // Calculate visible time range when zoomed
  let visibleStartTime = 0;
  let visibleEndTime = duration;
  let visibleDuration = duration;
  
  if (waveformZoom > 1 && waveformData) {
    const totalWidth = waveformData.length;
    visibleStartTime = (waveformScrollOffset / totalWidth) * duration;
    visibleEndTime = ((waveformScrollOffset + canvasWidth) / totalWidth) * duration;
    visibleDuration = visibleEndTime - visibleStartTime;
  }
  
  // Calculate appropriate interval based on visible duration
  const pixelsPerMarker = 80;
  const secondsPerMarker = (pixelsPerMarker / canvasWidth) * visibleDuration;
  const intervals = [0.5, 1, 2, 5, 10, 30, 60, 120, 300];
  const interval = intervals.find(i => i >= secondsPerMarker) || 60;
  
  // Round start time to nearest interval
  const startTime = Math.floor(visibleStartTime / interval) * interval;
  
  for (let time = startTime; time <= visibleEndTime; time += interval) {
    if (time < visibleStartTime) continue;
    const position = ((time - visibleStartTime) / visibleDuration) * 100;
    const mark = document.createElement("div");
    mark.className = "waveform-time-mark";
    mark.style.left = `${position}%`;
    mark.textContent = formatTime(time);
    waveformTimeRuler.appendChild(mark);
  }
}

function renderSegmentsOnWaveform() {
  if (!waveformSegments || !activeData?.segments || !audioEl.duration) return;
  
  waveformSegments.innerHTML = "";
  const duration = audioEl.duration;
  const container = document.getElementById("waveform-split-container") || waveformCanvas.parentElement;
  const canvasWidth = container.offsetWidth;
  
  // Calculate visible time range when zoomed
  let visibleStartTime = 0;
  let visibleEndTime = duration;
  
  if (waveformZoom > 1 && waveformData) {
    const totalWidth = waveformData.length;
    visibleStartTime = (waveformScrollOffset / totalWidth) * duration;
    visibleEndTime = ((waveformScrollOffset + canvasWidth) / totalWidth) * duration;
  }
  
  activeData.segments.forEach((segment, idx) => {
    // Skip segments outside visible range when zoomed
    if (waveformZoom > 1 && (segment.end < visibleStartTime || segment.start > visibleEndTime)) {
      return;
    }
    
    let startPct, widthPct;
    
    if (waveformZoom > 1 && waveformData) {
      const visibleDuration = visibleEndTime - visibleStartTime;
      const segStart = Math.max(segment.start, visibleStartTime);
      const segEnd = Math.min(segment.end, visibleEndTime);
      startPct = ((segStart - visibleStartTime) / visibleDuration) * 100;
      widthPct = ((segEnd - segStart) / visibleDuration) * 100;
    } else {
      startPct = (segment.start / duration) * 100;
      widthPct = ((segment.end - segment.start) / duration) * 100;
    }
    
    const segmentEl = document.createElement("div");
    segmentEl.className = "waveform-segment";
    segmentEl.style.left = `${startPct}%`;
    segmentEl.style.width = `${widthPct}%`;
    segmentEl.dataset.segment = idx;
    
    // Add phrase text overlay
    const phraseText = document.createElement("div");
    phraseText.className = "waveform-segment-text";
    // Get the text from words or use a fallback
    let text = "";
    if (segment.words && segment.words.length > 0) {
      text = segment.words.map(w => w.word || w.text || "").join(" ");
    } else if (segment.text) {
      text = segment.text;
    }
    phraseText.textContent = text;
    segmentEl.appendChild(phraseText);
    
    // Add speaker label (smaller, at top)
    const label = document.createElement("div");
    label.className = "waveform-segment-label";
    label.textContent = segment.speaker || `#${idx + 1}`;
    segmentEl.appendChild(label);
    
    // Add drag handles
    const leftHandle = document.createElement("div");
    leftHandle.className = "waveform-segment-handle left";
    leftHandle.dataset.handle = "start";
    leftHandle.dataset.segment = idx;
    segmentEl.appendChild(leftHandle);
    
    const rightHandle = document.createElement("div");
    rightHandle.className = "waveform-segment-handle right";
    rightHandle.dataset.handle = "end";
    rightHandle.dataset.segment = idx;
    segmentEl.appendChild(rightHandle);
    
    // Click to seek
    segmentEl.addEventListener("click", (e) => {
      if (e.target.classList.contains("waveform-segment-handle")) return;
      audioEl.currentTime = segment.start;
      audioEl.play();
    });
    
    // Drag handles for adjusting boundaries
    setupDragHandle(leftHandle, segment, idx, "start");
    setupDragHandle(rightHandle, segment, idx, "end");
    
    waveformSegments.appendChild(segmentEl);
  });
}

function setupDragHandle(handle, segment, segIdx, handleType) {
  let isDragging = false;
  let dragStartX = 0;
  let originalTime = 0;
  let containerRect = null;
  
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging = true;
    const container = document.getElementById("waveform-split-container") || waveformCanvas.parentElement;
    containerRect = container.getBoundingClientRect();
    dragStartX = e.clientX - containerRect.left;
    originalTime = handleType === "start" ? segment.start : segment.end;
    document.body.style.cursor = "ew-resize";
  });
  
  const moveHandler = (e) => {
    if (!isDragging || !containerRect) return;
    
    const width = containerRect.width;
    const duration = audioEl.duration;
    
    // Get container-relative mouse position
    const mouseX = e.clientX - containerRect.left;
    
    // Calculate time at mouse position, accounting for zoom and scroll
    let newTime;
    if (waveformZoom > 1 && waveformData) {
      const totalWidth = waveformData.length;
      const positionInData = mouseX + waveformScrollOffset;
      newTime = (positionInData / totalWidth) * duration;
    } else {
      newTime = (mouseX / width) * duration;
    }
    
    // Get adjacent segments for boundary linking
    const prevSegment = segIdx > 0 ? activeData.segments[segIdx - 1] : null;
    const nextSegment = segIdx < activeData.segments.length - 1 ? activeData.segments[segIdx + 1] : null;
    
    // Constraints and adjacent segment linking
    if (handleType === "start") {
      // Don't go before previous segment's start + 0.05s buffer
      const minTime = prevSegment ? prevSegment.start + 0.05 : 0;
      newTime = Math.max(minTime, Math.min(newTime, segment.end - 0.05));
      segment.start = newTime;
      
      // Link to previous segment's end (no overlap)
      if (prevSegment) {
        prevSegment.end = newTime;
        if (activeData?.segments[segIdx - 1]) {
          activeData.segments[segIdx - 1].end = newTime;
        }
      }
    } else {
      // Don't go past next segment's end - 0.05s buffer
      const maxTime = nextSegment ? nextSegment.end - 0.05 : duration;
      newTime = Math.max(segment.start + 0.05, Math.min(newTime, maxTime));
      segment.end = newTime;
      
      // Link to next segment's start (no overlap)
      if (nextSegment) {
        nextSegment.start = newTime;
        if (activeData?.segments[segIdx + 1]) {
          activeData.segments[segIdx + 1].start = newTime;
        }
      }
    }
    
    // Update activeData
    if (activeData?.segments[segIdx]) {
      activeData.segments[segIdx][handleType] = newTime;
    }
    
    renderSegmentsOnWaveform();
    renderWordsOnWaveform();
  };
  
  const upHandler = async () => {
    if (isDragging) {
      isDragging = false;
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", moveHandler);
      document.removeEventListener("mouseup", upHandler);
      
      // Save changes
      if (activeId && activeData) {
        await updateHistory(activeId, { segments: activeData.segments });
        rebuildActiveWords();
        renderTranscript(activeData);
      }
    }
  };
  
  handle.addEventListener("mousedown", () => {
    document.addEventListener("mousemove", moveHandler);
    document.addEventListener("mouseup", upHandler);
  });
}

function startVisualization() {
  if (animationFrameId) return;
  
  function animate() {
    // Always update playhead position
    updatePlayhead();
    
    // Only redraw waveform when playing (it's expensive)
    if (currentWaveformView === "waveform" && !audioEl.paused) {
      drawWaveform();
    }
    
    // Auto-scroll spectrogram when zoomed and playing
    if ((currentWaveformView === "spectrogram" || currentWaveformView === "both") && waveformZoom > 1 && audioEl.duration && !audioEl.paused) {
       const totalWidth = waveformData ? waveformData.length : 0;
       const playheadPosition = (audioEl.currentTime / audioEl.duration) * totalWidth;
       const container = document.getElementById("waveform-split-container") || waveformCanvas.parentElement;
       const canvasWidth = container.offsetWidth;
       
       const targetOffset = Math.max(0, Math.min(playheadPosition - canvasWidth / 2, totalWidth - canvasWidth));
       
       // Only redraw if scroll changed significantly to avoid thrashing
       if (Math.abs(targetOffset - waveformScrollOffset) > 5) {
         waveformScrollOffset = targetOffset;
         computeSpectrogram();
         renderSegmentsOnWaveform();
         renderWordsOnWaveform();
         updateTimeRuler();
       }
    }
    
    animationFrameId = requestAnimationFrame(animate);
  }
  
  animate();
}

function stopVisualization() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

// Waveform panel event listeners
if (toggleWaveformBtn) {
  toggleWaveformBtn.addEventListener("click", toggleWaveformPanel);
}

if (waveformCloseBtn) {
  waveformCloseBtn.addEventListener("click", toggleWaveformPanel);
}

if (tabWaveform) {
  tabWaveform.addEventListener("click", () => {
    currentWaveformView = "waveform";
    tabWaveform.classList.add("active");
    tabSpectrogram.classList.remove("active");
    waveformCanvas.classList.remove("hidden");
    spectrogramCanvas.classList.add("hidden");
    drawWaveform();
  });
}

if (tabSpectrogram) {
  tabSpectrogram.addEventListener("click", () => {
    currentWaveformView = "spectrogram";
    tabSpectrogram.classList.add("active");
    tabWaveform.classList.remove("active");
    spectrogramCanvas.classList.remove("hidden");
    waveformCanvas.classList.add("hidden");
    ensureAudioSource();
    // Clear and start fresh
    // spectrogramCtx.clearRect(0, 0, spectrogramCanvas.width, spectrogramCanvas.height);
    computeSpectrogram();
  });
}

if (zoomInBtn) {
  zoomInBtn.addEventListener("click", () => {
    const oldZoom = waveformZoom;
    waveformZoom = Math.min(waveformZoom * 1.5, 10);
    
    // Preserve relative scroll position when zooming in
    // Scale scroll offset proportionally to new zoom level
    if (oldZoom > 1) {
      waveformScrollOffset = waveformScrollOffset * (waveformZoom / oldZoom);
    }
    
    computeWaveformData().then(() => {
      updateTimeRuler();
      renderSegmentsOnWaveform();
      renderWordsOnWaveform();
      updatePlayhead();
      if (currentWaveformView === "waveform") {
        drawWaveform();
      } else {
        computeSpectrogram();
      }
    });
  });
}

if (zoomOutBtn) {
  zoomOutBtn.addEventListener("click", () => {
    const oldZoom = waveformZoom;
    waveformZoom = Math.max(waveformZoom / 1.5, 1); // Min zoom is 1 (fit to width)
    
    // Scale scroll offset proportionally, reset to 0 when fully zoomed out
    if (waveformZoom <= 1) {
      waveformScrollOffset = 0;
    } else {
      waveformScrollOffset = Math.max(0, waveformScrollOffset * (waveformZoom / oldZoom));
    }
    
    computeWaveformData().then(() => {
      updateTimeRuler();
      renderSegmentsOnWaveform();
      renderWordsOnWaveform();
      updatePlayhead();
      if (currentWaveformView === "waveform") {
        drawWaveform();
      } else {
        computeSpectrogram();
      }
    });
  });
}

// Click on waveform/spectrogram container to seek
function handleCanvasClick(e) {
  if (!audioEl.duration || !waveformCanvasContainer) return;

  // Ignore clicks on drag handles
  if (e.target.closest(".waveform-segment-handle") || e.target.closest(".waveform-word-handle")) return;
  
  // Ignore shift+click (used for selection)
  if (e.shiftKey) return;

  const rect = waveformCanvasContainer.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const canvasWidth = rect.width;

  let newTime;

  // Apply zoom/scroll calculation for ALL views, not just waveform
  if (waveformZoom > 1 && waveformData) {
    // When zoomed, calculate position relative to scroll offset
    const totalWidth = waveformData.length;
    const clickPositionInData = x + waveformScrollOffset;
    // Clamp to valid range
    const clampedPosition = Math.max(0, Math.min(clickPositionInData, totalWidth));
    newTime = (clampedPosition / totalWidth) * audioEl.duration;
  } else {
    newTime = (x / canvasWidth) * audioEl.duration;
  }

  // Seek to clicked position (clamp to valid range)
  audioEl.currentTime = Math.max(0, Math.min(newTime, audioEl.duration));

  // If already playing, keep playing. If paused, stay paused.
  if (!audioEl.paused) {
    audioEl.play();
  }
  updatePlayhead();
}

if (waveformCanvasContainer) {
  waveformCanvasContainer.addEventListener("pointerdown", handleCanvasClick, true);
  
  // Add scroll wheel support for panning when zoomed
  waveformCanvasContainer.addEventListener("wheel", (e) => {
    if (waveformZoom <= 1 || !waveformData) return;
    
    e.preventDefault();
    
    const container = document.getElementById("waveform-split-container") || waveformCanvas.parentElement;
    const canvasWidth = container.offsetWidth;
    const totalWidth = waveformData.length;
    
    // Scroll horizontally (shift+wheel or horizontal scroll)
    const delta = e.shiftKey ? e.deltaY : e.deltaX || e.deltaY;
    const scrollAmount = delta * 0.5; // Adjust sensitivity
    
    waveformScrollOffset = Math.max(0, Math.min(waveformScrollOffset + scrollAmount, totalWidth - canvasWidth));
    
    // Redraw with new scroll position
    if (currentWaveformView === "waveform") {
      drawWaveform();
    } else {
      computeSpectrogram();
    }
    renderSegmentsOnWaveform();
    renderWordsOnWaveform();
    updateTimeRuler();
    updatePlayhead();
  }, { passive: false });
}

// =============================================
// PLAYBACK SPEED CONTROLS
// =============================================

const speedBtn = document.getElementById("speed-btn");
const speedMenu = document.getElementById("speed-menu");
const speedLabel = document.getElementById("speed-label");
let currentSpeed = 1;

if (speedBtn && speedMenu) {
  speedBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    speedMenu.classList.toggle("hidden");
  });
  
  document.addEventListener("click", (e) => {
    if (!speedMenu.contains(e.target) && e.target !== speedBtn) {
      speedMenu.classList.add("hidden");
    }
  });
  
  speedMenu.querySelectorAll(".speed-option").forEach(option => {
    option.addEventListener("click", () => {
      const speed = parseFloat(option.dataset.speed);
      setPlaybackSpeed(speed);
      speedMenu.classList.add("hidden");
    });
  });
}

function setPlaybackSpeed(speed) {
  currentSpeed = speed;
  audioEl.playbackRate = speed;
  if (speedLabel) {
    speedLabel.textContent = `${speed}x`;
    speedBtn.setAttribute("aria-label", `Playback speed: ${speed}x`);
  }
  
  // Update active state in menu
  speedMenu.querySelectorAll(".speed-option").forEach(opt => {
    opt.classList.toggle("active", parseFloat(opt.dataset.speed) === speed);
  });
}

// =============================================
// SKIP FORWARD/BACK BUTTONS
// =============================================

const skipBackBtn = document.getElementById("skip-back");
const skipForwardBtn = document.getElementById("skip-forward");

if (skipBackBtn) {
  skipBackBtn.addEventListener("click", () => {
    audioEl.currentTime = Math.max(0, audioEl.currentTime - 5);
  });
}

if (skipForwardBtn) {
  skipForwardBtn.addEventListener("click", () => {
    audioEl.currentTime = Math.min(audioEl.duration, audioEl.currentTime + 5);
  });
}

// =============================================
// GLOBAL SPACEBAR PLAY/PAUSE
// =============================================

document.addEventListener("keydown", (e) => {
  const isSpace = e.code === "Space" || e.key === " " || e.key === "Spacebar";
  if (!isSpace) return;
  if (editState) return;
  if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
  if (e.target && e.target.isContentEditable) return;
  e.preventDefault();
  e.stopPropagation();
  if (audioEl.paused) {
    audioEl.play();
  } else {
    audioEl.pause();
  }
}, { capture: true });

// =============================================
// KEYBOARD SHORTCUTS
// =============================================

const shortcutsModal = document.getElementById("shortcuts-modal");
const shortcutsClose = document.getElementById("shortcuts-close");
let selectedSegmentIdx = null;

document.addEventListener("keydown", (e) => {
  // Don't trigger shortcuts when editing text
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) {
    // Allow Escape to cancel edit
    if (e.key === "Escape" && editState) {
      e.preventDefault();
      if (editState.el) {
        editState.el.textContent = editState.original;
        finalizeInlineEdit(editState.el, true);
      }
    }
    return;
  }
  
  switch (e.key) {
    case " ": // Space - Play/Pause
      e.preventDefault();
      if (audioEl.paused) {
        audioEl.play();
      } else {
        audioEl.pause();
      }
      break;
      
    case "ArrowLeft":
      e.preventDefault();
      if (e.shiftKey) {
        audioEl.currentTime = Math.max(0, audioEl.currentTime - 10);
      } else {
        audioEl.currentTime = Math.max(0, audioEl.currentTime - 5);
      }
      break;
      
    case "ArrowRight":
      e.preventDefault();
      if (e.shiftKey) {
        audioEl.currentTime = Math.min(audioEl.duration || 0, audioEl.currentTime + 10);
      } else {
        audioEl.currentTime = Math.min(audioEl.duration || 0, audioEl.currentTime + 5);
      }
      break;
      
    case "ArrowUp":
      e.preventDefault();
      navigateSegment(-1);
      break;
      
    case "ArrowDown":
      e.preventDefault();
      navigateSegment(1);
      break;
      
    case "Home":
      e.preventDefault();
      audioEl.currentTime = 0;
      break;
      
    case "End":
      e.preventDefault();
      audioEl.currentTime = audioEl.duration || 0;
      break;
      
    case "[":
      e.preventDefault();
      setPlaybackSpeed(Math.max(0.25, currentSpeed - 0.25));
      break;
      
    case "]":
      e.preventDefault();
      setPlaybackSpeed(Math.min(3, currentSpeed + 0.25));
      break;
      
    case "w":
    case "W":
      e.preventDefault();
      toggleWaveformPanel();
      break;
      
    case "?":
      e.preventDefault();
      toggleShortcutsModal();
      break;
      
    case "Escape":
      if (!shortcutsModal.classList.contains("hidden")) {
        e.preventDefault();
        shortcutsModal.classList.add("hidden");
      }
      break;
  }
});

function navigateSegment(direction) {
  if (!activeData?.segments?.length) return;
  
  if (selectedSegmentIdx === null) {
    selectedSegmentIdx = direction > 0 ? 0 : activeData.segments.length - 1;
  } else {
    selectedSegmentIdx = Math.max(0, Math.min(activeData.segments.length - 1, selectedSegmentIdx + direction));
  }
  
  const segment = activeData.segments[selectedSegmentIdx];
  if (segment) {
    audioEl.currentTime = segment.start;
    
    // Scroll segment into view
    const segmentEl = document.querySelector(`.segment[data-segment="${selectedSegmentIdx}"]`);
    if (segmentEl) {
      segmentEl.scrollIntoView({ behavior: "smooth", block: "center" });
      
      // Highlight
      document.querySelectorAll(".segment.selected").forEach(el => el.classList.remove("selected"));
      segmentEl.classList.add("selected");
    }
  }
}

function toggleShortcutsModal() {
  shortcutsModal.classList.toggle("hidden");
}

if (shortcutsClose) {
  shortcutsClose.addEventListener("click", () => {
    shortcutsModal.classList.add("hidden");
  });
}

if (shortcutsModal) {
  shortcutsModal.addEventListener("click", (e) => {
    if (e.target === shortcutsModal) {
      shortcutsModal.classList.add("hidden");
    }
  });
}

// =============================================
// INLINE TIMESTAMP EDITING
// =============================================

function createTimestampEditor(segmentEl, segment, segIdx) {
  const timeEl = segmentEl.querySelector(".segment-time");
  if (!timeEl || timeEl.classList.contains("editing")) return;
  
  timeEl.classList.add("editing");
  
  const originalStart = segment.start;
  const originalEnd = segment.end;
  
  const editor = document.createElement("div");
  editor.className = "timestamp-editor";
  editor.innerHTML = `
    <input type="text" class="timestamp-input" id="ts-start" value="${formatTimeMs(segment.start)}" placeholder="0:00.00">
    <span class="timestamp-separator">→</span>
    <input type="text" class="timestamp-input" id="ts-end" value="${formatTimeMs(segment.end)}" placeholder="0:00.00">
    <div class="timestamp-actions">
      <button class="timestamp-action-btn save" title="Save">✓</button>
      <button class="timestamp-action-btn cancel" title="Cancel">✕</button>
    </div>
  `;
  
  timeEl.innerHTML = "";
  timeEl.appendChild(editor);
  
  const startInput = editor.querySelector("#ts-start");
  const endInput = editor.querySelector("#ts-end");
  const saveBtn = editor.querySelector(".save");
  const cancelBtn = editor.querySelector(".cancel");
  
  startInput.focus();
  startInput.select();
  
  async function saveTimestamps() {
    const newStart = parseTimeMs(startInput.value);
    const newEnd = parseTimeMs(endInput.value);
    
    if (isNaN(newStart) || isNaN(newEnd) || newStart >= newEnd) {
      alert("Invalid timestamps. Start must be before end.");
      return;
    }
    
    segment.start = newStart;
    segment.end = newEnd;
    
    if (activeData?.segments[segIdx]) {
      activeData.segments[segIdx].start = newStart;
      activeData.segments[segIdx].end = newEnd;
    }
    
    await updateHistory(activeId, { segments: activeData.segments });
    rebuildActiveWords();
    renderTranscript(activeData);
    if (isWaveformVisible) {
      renderSegmentsOnWaveform();
    }
  }
  
  function cancelEdit() {
    segment.start = originalStart;
    segment.end = originalEnd;
    timeEl.classList.remove("editing");
    timeEl.textContent = formatTimeRange(originalStart, originalEnd);
    timeEl.classList.add("editable");
  }
  
  saveBtn.addEventListener("click", saveTimestamps);
  cancelBtn.addEventListener("click", cancelEdit);
  
  startInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveTimestamps();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      endInput.focus();
      endInput.select();
    }
  });
  
  endInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveTimestamps();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    } else if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      startInput.focus();
      startInput.select();
    }
  });
}

function formatTimeMs(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(2);
  return `${mins}:${secs.padStart(5, "0")}`;
}

function parseTimeMs(str) {
  const parts = str.split(":");
  if (parts.length === 2) {
    const mins = parseInt(parts[0], 10);
    const secs = parseFloat(parts[1]);
    return mins * 60 + secs;
  } else if (parts.length === 1) {
    return parseFloat(parts[0]);
  }
  return NaN;
}

// =============================================
// AUTO-SCROLL TRANSCRIPT
// =============================================

let autoScrollEnabled = true;
let userScrolled = false;
let scrollTimeout = null;

// Detect user scroll
if (transcriptEl) {
  transcriptEl.addEventListener("scroll", () => {
    userScrolled = true;
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      userScrolled = false;
    }, 3000);
  });
}

function scrollToCurrentWord(wordEl) {
  if (!wordEl || !autoScrollEnabled || userScrolled) return;
  
  const rect = wordEl.getBoundingClientRect();
  const containerRect = transcriptEl.getBoundingClientRect();
  
  const isVisible = rect.top >= containerRect.top && rect.bottom <= containerRect.bottom;
  
  if (!isVisible) {
    wordEl.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

// =============================================
// ENHANCED AUDIO EVENTS
// =============================================

// Update timeupdate to include auto-scroll
const originalTimeUpdate = audioEl.ontimeupdate;
audioEl.addEventListener("timeupdate", () => {
  // Existing functionality continues to work
  // Add auto-scroll
  if (currentWord && autoScrollEnabled) {
    scrollToCurrentWord(currentWord);
  }
  
  // Update waveform if visible
  if (isWaveformVisible) {
    updatePlayhead();
    if (currentWaveformView === "waveform") {
      drawWaveform();
    }
  }
});

// Re-initialize visualization when audio source changes
audioEl.addEventListener("loadedmetadata", () => {
  if (isWaveformVisible) {
    ensureAudioSource();
    computeWaveformData().then(() => {
      if (currentWaveformView === "spectrogram") computeSpectrogram();
    });
    updateTimeRuler();
    renderSegmentsOnWaveform();
  }
});

audioEl.addEventListener("play", () => {
  ensureAudioSource();
  // Start animation loop if panel is visible
  if (isWaveformVisible) {
    startVisualization();
  }
});

audioEl.addEventListener("pause", () => {
  // Redraw once when pausing to ensure final position is shown
  if (isWaveformVisible) {
    if (currentWaveformView === "waveform") {
      drawWaveform();
    }
    updatePlayhead();
  }
});

// =============================================
// ENHANCED TRANSCRIPT RENDERING
// =============================================

// Modify renderBoxTranscript to add clickable timestamps
const originalRenderBoxTranscript = renderBoxTranscript;
window.renderBoxTranscript = function(data) {
  originalRenderBoxTranscript(data);
  
  // Make timestamps clickable for editing
  document.querySelectorAll(".segment-time").forEach((timeEl, idx) => {
    timeEl.classList.add("editable");
    timeEl.addEventListener("click", (e) => {
      e.stopPropagation();
      const segmentEl = timeEl.closest(".segment");
      const segment = data.segments[idx];
      if (segment && segmentEl) {
        createTimestampEditor(segmentEl, segment, idx);
      }
    });
  });
};

// Window resize handler
window.addEventListener("resize", () => {
  if (isWaveformVisible) {
    resizeWaveformCanvas();
    computeWaveformData().then(() => {
      if (currentWaveformView === "spectrogram") computeSpectrogram();
    });
    updateTimeRuler();
    renderSegmentsOnWaveform();
  }
});

// =============================================
// WORD-LEVEL BOUNDARIES OVERLAY
// =============================================

const waveformWords = document.getElementById("waveform-words");
const toggleWordsBtn = document.getElementById("toggle-words");
let showWordBoundaries = true;
let selectedWordIdx = null;

function renderWordsOnWaveform() {
  if (!waveformWords || !activeData?.segments || !audioEl.duration) return;
  
  waveformWords.innerHTML = "";
  
  if (!showWordBoundaries) return;
  
  const duration = audioEl.duration;
  const container = document.getElementById("waveform-split-container") || waveformCanvas.parentElement;
  const canvasWidth = container.offsetWidth;
  
  // Calculate visible time range when zoomed
  let visibleStartTime = 0;
  let visibleEndTime = duration;
  
  if (waveformZoom > 1 && waveformData) {
    const totalWidth = waveformData.length;
    visibleStartTime = (waveformScrollOffset / totalWidth) * duration;
    visibleEndTime = ((waveformScrollOffset + canvasWidth) / totalWidth) * duration;
  }
  
  let globalWordIdx = 0;
  
  activeData.segments.forEach((segment) => {
    if (!segment.words) return;
    
    segment.words.forEach((word) => {
      const wordStart = word.start ?? segment.start;
      const wordEnd = word.end ?? segment.end;
      
      // Skip words outside visible range when zoomed
      if (waveformZoom > 1 && (wordEnd < visibleStartTime || wordStart > visibleEndTime)) {
        globalWordIdx++;
        return;
      }
      
      let leftPct, widthPct;
      
      if (waveformZoom > 1 && waveformData) {
        const visibleDuration = visibleEndTime - visibleStartTime;
        const wStart = Math.max(wordStart, visibleStartTime);
        const wEnd = Math.min(wordEnd, visibleEndTime);
        leftPct = ((wStart - visibleStartTime) / visibleDuration) * 100;
        widthPct = ((wEnd - wStart) / visibleDuration) * 100;
      } else {
        leftPct = (wordStart / duration) * 100;
        widthPct = ((wordEnd - wordStart) / duration) * 100;
      }
      
      const wordEl = document.createElement("div");
      wordEl.className = "waveform-word";
      wordEl.style.left = `${leftPct}%`;
      wordEl.style.width = `${Math.max(0.5, widthPct)}%`;
      wordEl.dataset.wordIdx = globalWordIdx;
      
      if (globalWordIdx === selectedWordIdx) {
        wordEl.classList.add("selected");
      }
      
      // Label
      const label = document.createElement("div");
      label.className = "waveform-word-label";
      label.textContent = word.word || word.text || "";
      wordEl.appendChild(label);
      
      // Drag handles
      const leftHandle = document.createElement("div");
      leftHandle.className = "waveform-word-handle left";
      wordEl.appendChild(leftHandle);
      
      const rightHandle = document.createElement("div");
      rightHandle.className = "waveform-word-handle right";
      wordEl.appendChild(rightHandle);
      
      // Click to select and play
      wordEl.addEventListener("click", (e) => {
        if (e.target.classList.contains("waveform-word-handle")) return;
        selectedWordIdx = parseInt(wordEl.dataset.wordIdx);
        audioEl.currentTime = wordStart;
        if (audioEl.paused) audioEl.play();
        renderWordsOnWaveform();
      });
      
      // Drag handles for word boundary editing
      setupWordDragHandle(leftHandle, word, segment, "start");
      setupWordDragHandle(rightHandle, word, segment, "end");
      
      waveformWords.appendChild(wordEl);
      globalWordIdx++;
    });
  });
}

function setupWordDragHandle(handle, word, segment, handleType) {
  let isDragging = false;
  let containerRect = null;
  
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging = true;
    const container = document.getElementById("waveform-split-container") || waveformCanvas.parentElement;
    containerRect = container.getBoundingClientRect();
    document.body.style.cursor = "ew-resize";
  });
  
  const moveHandler = (e) => {
    if (!isDragging || !containerRect) return;
    
    const width = containerRect.width;
    const duration = audioEl.duration;
    
    // Get container-relative mouse position
    const mouseX = e.clientX - containerRect.left;
    
    // Calculate time at mouse position, accounting for zoom and scroll
    let newTime;
    if (waveformZoom > 1 && waveformData) {
      const totalWidth = waveformData.length;
      const positionInData = mouseX + waveformScrollOffset;
      newTime = (positionInData / totalWidth) * duration;
    } else {
      newTime = (mouseX / width) * duration;
    }
    
    // Constraints
    const wordStart = word.start ?? segment.start;
    const wordEnd = word.end ?? segment.end;
    
    if (handleType === "start") {
      newTime = Math.max(segment.start, Math.min(newTime, wordEnd - 0.01));
      word.start = newTime;
    } else {
      newTime = Math.max(wordStart + 0.01, Math.min(newTime, segment.end));
      word.end = newTime;
    }
    
    renderWordsOnWaveform();
  };
  
  const upHandler = async () => {
    if (isDragging) {
      isDragging = false;
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", moveHandler);
      document.removeEventListener("mouseup", upHandler);
      
      // Save changes
      if (activeId && activeData) {
        await updateHistory(activeId, { segments: activeData.segments });
        rebuildActiveWords();
      }
    }
  };
  
  handle.addEventListener("mousedown", () => {
    document.addEventListener("mousemove", moveHandler);
    document.addEventListener("mouseup", upHandler);
  });
}

if (toggleWordsBtn) {
  toggleWordsBtn.addEventListener("click", () => {
    showWordBoundaries = !showWordBoundaries;
    toggleWordsBtn.classList.toggle("active", showWordBoundaries);
    renderWordsOnWaveform();
  });
  toggleWordsBtn.classList.add("active");
}

// =============================================
// SELECTION & LOOP PLAYBACK
// =============================================

const waveformSelection = document.getElementById("waveform-selection");
const loopSelectionBtn = document.getElementById("loop-selection");
let selectionStart = null;
let selectionEnd = null;
let isLooping = false;
let isSelecting = false;

function updateSelectionDisplay() {
  if (!waveformSelection || selectionStart === null || selectionEnd === null) {
    if (waveformSelection) waveformSelection.classList.remove("active");
    return;
  }
  
  const duration = audioEl.duration;
  if (!duration) return;
  
  const container = document.getElementById("waveform-split-container") || waveformCanvas.parentElement;
  const canvasWidth = container.offsetWidth;
  
  let startPct, endPct;
  
  if (waveformZoom > 1 && waveformData) {
    const totalWidth = waveformData.length;
    const visibleStartTime = (waveformScrollOffset / totalWidth) * duration;
    const visibleEndTime = ((waveformScrollOffset + canvasWidth) / totalWidth) * duration;
    const visibleDuration = visibleEndTime - visibleStartTime;
    
    startPct = ((Math.max(selectionStart, visibleStartTime) - visibleStartTime) / visibleDuration) * 100;
    endPct = ((Math.min(selectionEnd, visibleEndTime) - visibleStartTime) / visibleDuration) * 100;
  } else {
    startPct = (selectionStart / duration) * 100;
    endPct = (selectionEnd / duration) * 100;
  }
  
  waveformSelection.style.left = `${startPct}%`;
  waveformSelection.style.width = `${endPct - startPct}%`;
  waveformSelection.classList.add("active");
  waveformSelection.classList.toggle("looping", isLooping);
}

function clearSelection() {
  selectionStart = null;
  selectionEnd = null;
  isLooping = false;
  updateSelectionDisplay();
  if (loopSelectionBtn) loopSelectionBtn.classList.remove("active");
}

function playSelection() {
  if (selectionStart !== null && selectionEnd !== null) {
    audioEl.currentTime = selectionStart;
    audioEl.play();
  }
}

function toggleLoop() {
  if (selectionStart === null || selectionEnd === null) return;
  isLooping = !isLooping;
  if (loopSelectionBtn) loopSelectionBtn.classList.toggle("active", isLooping);
  updateSelectionDisplay();
  if (isLooping) {
    audioEl.currentTime = selectionStart;
    audioEl.play();
  }
}

// Loop enforcement
audioEl.addEventListener("timeupdate", () => {
  if (isLooping && selectionStart !== null && selectionEnd !== null) {
    if (audioEl.currentTime >= selectionEnd) {
      audioEl.currentTime = selectionStart;
    }
  }
});

if (loopSelectionBtn) {
  loopSelectionBtn.addEventListener("click", toggleLoop);
}

// Selection via drag on waveform
const waveformOverlays = document.getElementById("waveform-overlays");
if (waveformOverlays) {
  let dragStartX = 0;
  let dragStartTime = 0;
  
  waveformOverlays.addEventListener("mousedown", (e) => {
    if (e.target.closest(".waveform-word-handle") || e.target.closest(".waveform-segment-handle")) return;
    if (e.shiftKey) {
      // Shift+click to create selection
      isSelecting = true;
      dragStartX = e.clientX;
      const container = document.getElementById("waveform-split-container") || waveformCanvas.parentElement;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const duration = audioEl.duration;
      
      if (waveformZoom > 1 && waveformData) {
        const totalWidth = waveformData.length;
        const visibleStartTime = (waveformScrollOffset / totalWidth) * duration;
        const visibleDuration = ((container.offsetWidth) / totalWidth) * duration;
        dragStartTime = visibleStartTime + (x / container.offsetWidth) * visibleDuration;
      } else {
        dragStartTime = (x / container.offsetWidth) * duration;
      }
      
      selectionStart = dragStartTime;
      selectionEnd = dragStartTime;
      updateSelectionDisplay();
      e.preventDefault();
    }
  });
  
  document.addEventListener("mousemove", (e) => {
    if (!isSelecting) return;
    
    const container = document.getElementById("waveform-split-container") || waveformCanvas.parentElement;
    const rect = container.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, container.offsetWidth));
    const duration = audioEl.duration;
    
    let currentTime;
    if (waveformZoom > 1 && waveformData) {
      const totalWidth = waveformData.length;
      const visibleStartTime = (waveformScrollOffset / totalWidth) * duration;
      const visibleDuration = ((container.offsetWidth) / totalWidth) * duration;
      currentTime = visibleStartTime + (x / container.offsetWidth) * visibleDuration;
    } else {
      currentTime = (x / container.offsetWidth) * duration;
    }
    
    if (currentTime < dragStartTime) {
      selectionStart = currentTime;
      selectionEnd = dragStartTime;
    } else {
      selectionStart = dragStartTime;
      selectionEnd = currentTime;
    }
    
    updateSelectionDisplay();
  });
  
  document.addEventListener("mouseup", () => {
    if (isSelecting) {
      isSelecting = false;
      // If selection is too small, clear it
      if (selectionEnd - selectionStart < 0.05) {
        clearSelection();
      }
    }
  });
}

// Update existing tab handlers
if (tabWaveform) {
  const originalHandler = tabWaveform.onclick;
  tabWaveform.addEventListener("click", () => {
    waveformPanel.classList.remove("split-view");
    waveformPanel.dataset.view = "waveform";
  });
}

if (tabSpectrogram) {
  tabSpectrogram.addEventListener("click", () => {
    waveformPanel.classList.remove("split-view");
    waveformPanel.dataset.view = "spectrogram";
  });
}

// =============================================
// CURSOR MEASUREMENT DISPLAY
// =============================================

const cursorTimeEl = document.getElementById("cursor-time");
const cursorFreqEl = document.getElementById("cursor-freq");

const splitContainer = document.getElementById("waveform-split-container");
if (splitContainer) {
  splitContainer.addEventListener("mousemove", (e) => {
    const rect = splitContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const width = rect.width;
    const height = rect.height;
    
    if (!audioEl.duration) return;
    
    const duration = audioEl.duration;
    let time;
    
    if (waveformZoom > 1 && waveformData) {
      const totalWidth = waveformData.length;
      const visibleStartTime = (waveformScrollOffset / totalWidth) * duration;
      const visibleDuration = (width / totalWidth) * duration;
      time = visibleStartTime + (x / width) * visibleDuration;
    } else {
      time = (x / width) * duration;
    }
    
    // Frequency (assuming spectrogram view, linear scale 0-8000Hz)
    const maxFreq = audioBufferCache ? audioBufferCache.sampleRate / 2 : 8000;
    const freq = maxFreq * (1 - y / height);
    
    if (cursorTimeEl) {
      cursorTimeEl.textContent = formatTimeMs(time);
    }
    if (cursorFreqEl && (currentWaveformView === "spectrogram" || currentWaveformView === "both")) {
      cursorFreqEl.textContent = `${Math.round(freq)} Hz`;
      cursorFreqEl.style.display = "";
    } else if (cursorFreqEl) {
      cursorFreqEl.style.display = "none";
    }
  });
}

// =============================================
// IPA CHARACTER PICKER
// =============================================

const ipaPicker = document.getElementById("ipa-picker");
const ipaGrid = document.getElementById("ipa-grid");
const ipaPickerClose = document.getElementById("ipa-picker-close");
let currentEditingInput = null;

const IPA_CHARS = {
  consonants: [
    "p", "b", "t", "d", "ʈ", "ɖ", "c", "ɟ", "k", "ɡ", "q", "ɢ", "ʔ",
    "m", "ɱ", "n", "ɳ", "ɲ", "ŋ", "ɴ",
    "ʙ", "r", "ʀ",
    "ⱱ", "ɾ", "ɽ",
    "ɸ", "β", "f", "v", "θ", "ð", "s", "z", "ʃ", "ʒ", "ʂ", "ʐ", "ç", "ʝ",
    "x", "ɣ", "χ", "ʁ", "ħ", "ʕ", "h", "ɦ",
    "ɬ", "ɮ",
    "ʋ", "ɹ", "ɻ", "j", "ɰ",
    "l", "ɭ", "ʎ", "ʟ",
    "ʘ", "ǀ", "ǃ", "ǂ", "ǁ",
    "ɓ", "ɗ", "ʄ", "ɠ", "ʛ",
    "w", "ʍ", "ɥ", "ʜ", "ʢ", "ʡ", "ɕ", "ʑ", "ɺ", "ɧ"
  ],
  vowels: [
    "i", "y", "ɨ", "ʉ", "ɯ", "u",
    "ɪ", "ʏ", "ʊ",
    "e", "ø", "ɘ", "ɵ", "ɤ", "o",
    "ə",
    "ɛ", "œ", "ɜ", "ɞ", "ʌ", "ɔ",
    "æ", "ɐ",
    "a", "ɶ", "ɑ", "ɒ"
  ],
  diacritics: [
    "ˈ", "ˌ", "ː", "ˑ", "̆", ".", "‿",
    "̥", "̬", "ʰ", "̹", "̜", "̟", "̠", "̈", "̽",
    "̩", "̯", "˞", "̤", "̰", "̼",
    "ʷ", "ʲ", "ˠ", "ˤ", "̴",
    "̝", "̞", "̘", "̙", "̪", "̺", "̻", "̃", "ⁿ", "ˡ",
    "̚"
  ],
  tones: [
    "˥", "˦", "˧", "˨", "˩",
    "̋", "́", "̄", "̀", "̏",
    "̌", "̂", "᷄", "᷅", "᷈",
    "↗", "↘"
  ]
};

function renderIPAGrid(category) {
  if (!ipaGrid) return;
  
  ipaGrid.innerHTML = "";
  const chars = IPA_CHARS[category] || [];
  
  chars.forEach(char => {
    const btn = document.createElement("button");
    btn.className = "ipa-char";
    btn.textContent = char;
    btn.title = char;
    btn.addEventListener("click", () => insertIPAChar(char));
    ipaGrid.appendChild(btn);
  });
}

function insertIPAChar(char) {
  if (currentEditingInput) {
    const start = currentEditingInput.selectionStart;
    const end = currentEditingInput.selectionEnd;
    const value = currentEditingInput.value;
    currentEditingInput.value = value.slice(0, start) + char + value.slice(end);
    currentEditingInput.selectionStart = currentEditingInput.selectionEnd = start + char.length;
    currentEditingInput.focus();
  } else {
    // Try to insert into currently focused editable element
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.isContentEditable || activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) {
      if (activeEl.isContentEditable) {
        document.execCommand("insertText", false, char);
      } else {
        const start = activeEl.selectionStart;
        const end = activeEl.selectionEnd;
        const value = activeEl.value;
        activeEl.value = value.slice(0, start) + char + value.slice(end);
        activeEl.selectionStart = activeEl.selectionEnd = start + char.length;
      }
    }
  }
}

function showIPAPicker(inputEl = null) {
  currentEditingInput = inputEl;
  if (ipaPicker) {
    ipaPicker.classList.remove("hidden");
    renderIPAGrid("consonants");
  }
}

function hideIPAPicker() {
  if (ipaPicker) {
    ipaPicker.classList.add("hidden");
  }
  currentEditingInput = null;
}

if (ipaPickerClose) {
  ipaPickerClose.addEventListener("click", hideIPAPicker);
}

// IPA tab switching
document.querySelectorAll(".ipa-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".ipa-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    renderIPAGrid(tab.dataset.category);
  });
});

// =============================================
// ENHANCED KEYBOARD SHORTCUTS
// =============================================

// Override the existing keyboard handler with enhanced version
document.removeEventListener("keydown", document.keydownHandler);

document.addEventListener("keydown", (e) => {
  // Don't trigger shortcuts when editing text (except specific ones)
  const isEditing = e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable;
  
  if (isEditing) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (editState && editState.el) {
        editState.el.textContent = editState.original;
        finalizeInlineEdit(editState.el, true);
      }
      hideIPAPicker();
    }
    return;
  }
  
  switch (e.key) {
    case " ": // Space - Play/Pause
      e.preventDefault();
      if (audioEl.paused) {
        audioEl.play();
      } else {
        audioEl.pause();
      }
      break;
      
    case "ArrowLeft":
      e.preventDefault();
      if (e.shiftKey) {
        audioEl.currentTime = Math.max(0, audioEl.currentTime - 10);
      } else {
        audioEl.currentTime = Math.max(0, audioEl.currentTime - 5);
      }
      break;
      
    case "ArrowRight":
      e.preventDefault();
      if (e.shiftKey) {
        audioEl.currentTime = Math.min(audioEl.duration || 0, audioEl.currentTime + 10);
      } else {
        audioEl.currentTime = Math.min(audioEl.duration || 0, audioEl.currentTime + 5);
      }
      break;
      
    case "ArrowUp":
      e.preventDefault();
      navigateSegment(-1);
      break;
      
    case "ArrowDown":
      e.preventDefault();
      navigateSegment(1);
      break;
      
    case "Home":
      e.preventDefault();
      audioEl.currentTime = 0;
      break;
      
    case "End":
      e.preventDefault();
      audioEl.currentTime = audioEl.duration || 0;
      break;
      
    case "[":
      e.preventDefault();
      setPlaybackSpeed(Math.max(0.25, currentSpeed - 0.25));
      break;
      
    case "]":
      e.preventDefault();
      setPlaybackSpeed(Math.min(3, currentSpeed + 0.25));
      break;
      
    case "w":
    case "W":
      e.preventDefault();
      toggleWaveformPanel();
      break;
      
    case "1":
      e.preventDefault();
      if (isWaveformVisible && tabWaveform) tabWaveform.click();
      break;
      
    case "2":
      e.preventDefault();
      if (isWaveformVisible && tabSpectrogram) tabSpectrogram.click();
      break;
      
    case "b":
    case "B":
      e.preventDefault();
      if (toggleWordsBtn) toggleWordsBtn.click();
      break;
      
    case "l":
    case "L":
      e.preventDefault();
      toggleLoop();
      break;
      
    case "p":
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        playSelection();
      }
      break;
      
    case "i":
    case "I":
      e.preventDefault();
      if (ipaPicker.classList.contains("hidden")) {
        showIPAPicker();
      } else {
        hideIPAPicker();
      }
      break;
      
    case "+":
    case "=":
      e.preventDefault();
      if (zoomInBtn) zoomInBtn.click();
      break;
      
    case "-":
    case "_":
      e.preventDefault();
      if (zoomOutBtn) zoomOutBtn.click();
      break;
      
    case "?":
      e.preventDefault();
      toggleShortcutsModal();
      break;
      
    case "Escape":
      if (!shortcutsModal.classList.contains("hidden")) {
        e.preventDefault();
        shortcutsModal.classList.add("hidden");
      }
      hideIPAPicker();
      clearSelection();
      break;
  }
});

// =============================================
// FREQUENCY AXIS RENDERING
// =============================================

const freqAxis = document.getElementById("waveform-freq-axis");

function updateFrequencyAxis() {
  if (!freqAxis) return;
  
  freqAxis.innerHTML = "";
  
  const maxFreq = audioBufferCache ? audioBufferCache.sampleRate / 2 : 8000;
  const freqMarks = [0, 1000, 2000, 4000, 6000, 8000].filter(f => f <= maxFreq);
  
  freqMarks.reverse().forEach(freq => {
    const mark = document.createElement("div");
    mark.className = "freq-mark";
    mark.textContent = freq >= 1000 ? `${freq/1000}k` : freq;
    freqAxis.appendChild(mark);
  });
}

// =============================================
// UPDATE VISUALIZATION HOOKS
// =============================================

// Extend toggleWaveformPanel to initialize new features
const originalToggleWaveformPanel = toggleWaveformPanel;
window.toggleWaveformPanel = function() {
  originalToggleWaveformPanel();
  
  if (isWaveformVisible) {
    renderWordsOnWaveform();
    updateFrequencyAxis();
    updateSelectionDisplay();
  }
};

// Extend computeSpectrogram to also update related displays
const originalComputeSpectrogram = computeSpectrogram;
window.computeSpectrogram = async function() {
  await originalComputeSpectrogram();
  renderWordsOnWaveform();
  updateSelectionDisplay();
};

// Ensure words update when segments change
const originalRenderSegmentsOnWaveform = renderSegmentsOnWaveform;
window.renderSegmentsOnWaveform = function() {
  originalRenderSegmentsOnWaveform();
  renderWordsOnWaveform();
};

// Blur buttons after click to ensure spacebar works for play/pause globally
document.addEventListener("click", (e) => {
  if (e.target.tagName === "BUTTON") {
    e.target.blur();
  }
});

console.log("OmniTranscribe Pro loaded. Press ? for keyboard shortcuts, I for IPA picker.");
