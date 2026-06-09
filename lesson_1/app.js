// app.js
// Multi mini-editors: JSON timeline + media (video | audio | YouTube) + seek + single play/pause
// While PLAYING → show ONLY read-only textarea; while PAUSED → show ONLY editable textarea.

// ===================== CONFIG: autoload map =====================
// Each entry: [ recordingJsonUrl, nodeIndex (1-based in .menu_editor list), mediaUrl, mediaType ]
// mediaType ∈ { "video", "audio", "youtube" } — mediaUrl optional for timeline-only.
const AUTO_MAP = [
  // Example:
  ["recording.json", 1, "https://www.youtube.com/watch?v=6OaOB8AWQKg", "youtube"],
   ["officiall1p2.json", 2, "officiall1p2.m4a", "audio"],
   ["officiall1p1.json", 3, "officialL1P1.m4a", "audio"],
   
];

// ===================== Utilities =====================
const fmtTime = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
};

// {line,ch} → string offset
function posToOffset(text, pos) {
  const lines = text.split("\n");
  let off = 0;
  const L = Math.max(0, Math.min((pos?.line ?? 0), lines.length - 1));
  for (let i = 0; i < L; i++) off += lines[i].length + 1;
  const ch = Math.max(0, Math.min((pos?.ch ?? 0), (lines[L] || "").length));
  return off + ch;
}
// Apply CodeMirror-style change to a plain string
function applyChangeToText(text, chg) {
  const from = posToOffset(text, chg?.from || { line: 0, ch: 0 });
  const to = posToOffset(text, chg?.to || { line: 0, ch: 0 });
  const ins = (chg?.text || []).join("\n");
  return text.slice(0, from) + ins + text.slice(to);
}

// ===================== YouTube helpers =====================
let _ytReadyPromise = null;
function loadYouTubeAPI() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (_ytReadyPromise) return _ytReadyPromise;
  _ytReadyPromise = new Promise((resolve) => {
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function () {
      if (typeof prev === "function") prev();
      resolve();
    };
  });
  return _ytReadyPromise;
}
function extractYouTubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1);
    if (u.hostname.includes("youtube.com")) {
      if (u.searchParams.get("v")) return u.searchParams.get("v");
      const m = u.pathname.match(/\/embed\/([^\/\?]+)/);
      if (m) return m[1];
    }
  } catch (_) {}
  // fallback: maybe it's already an id
  return url;
}

// ===================== Player factory =====================
function createMiniPlayer(root) {
  // Controls (support either class- or id-based markup)
  const btnLoad   = root.querySelector(".btnLoad")   || root.querySelector("#btnLoad");
  const fileJson  = root.querySelector(".fileJson")  || root.querySelector("#fileJson");
  const btnToggle = root.querySelector(".btnToggle") || root.querySelector("#btnToggle") || null;
  const btnPlay   = root.querySelector(".btnPlay")   || root.querySelector("#btnPlay");
  const btnPause  = root.querySelector(".btnPause")  || root.querySelector("#btnPause");
  const btnReset  = root.querySelector(".btnReset")  || root.querySelector("#btnReset");

  const seek      = root.querySelector(".seek");
  const timeLabel = root.querySelector(".timeLabel");
  const statusEl  = root.querySelector(".status") || root.querySelector("#status");

  const videoSlot = root.querySelector(".editorVideo") || root.querySelector("video"); // default slot
  const roWrap    = root.querySelector(".roWrap")   || root.querySelector("#roWrap");
  const editWrap  = root.querySelector(".editWrap") || root.querySelector("#editWrap");
  const txtRO     = root.querySelector(".txtReadonly") || root.querySelector("#txtReadonly");
  const txtEdit   = root.querySelector(".txtEdit")     || root.querySelector("#txtEdit");
  const frame     = root.querySelector(".outputFrame") || root.querySelector("#outputFrame");

  // Dynamic media instances
  let mediaType   = "none";     // "none" | "video" | "audio" | "youtube"
  let mediaEl     = null;       // HTMLMediaElement when video/audio
  let ytPlayer    = null;       // YT.Player instance
  let ytReady     = false;

  // Timeline state
  let events      = [];       // [{time, change:{...}}]
  let initial     = "";
  let durationMs  = 0;        // total length (max of media and timeline)
  let appliedIdx  = 0;        // next event index to apply
  let appliedTime = 0;        // last applied time in ms
  let topCode     = "";       // canonical (readonly)
  let playing     = false;
  let rafId       = null;     // synthetic clock when no media
  let offsetMs    = 0;        // base for synthetic clock
  let startTs     = 0;

  const setStatus = (m) => { if (statusEl) statusEl.textContent = m || ""; };
  const showRO = () => { if (roWrap) roWrap.style.display = "";  if (editWrap) editWrap.style.display = "none"; };
  const showED = () => { if (roWrap) roWrap.style.display = "none"; if (editWrap) editWrap.style.display = "";  };
  const render = (src) => { if (frame) frame.srcdoc = src || ""; };

  function updateTimeLabel(v) {
    if (!timeLabel || !seek) return;
    const cur = Number(v || 0);
    const total = Number(seek.max || 0);
    timeLabel.textContent = `${fmtTime(cur)} / ${fmtTime(total)}`;
  }
  function recalcDuration() {
    const lastEventTime = events.length ? (events[events.length - 1].time || 0) : 0;
    let mediaMs = 0;
    if (mediaType === "video" || mediaType === "audio") {
      if (mediaEl && isFinite(mediaEl.duration)) mediaMs = mediaEl.duration * 1000;
    } else if (mediaType === "youtube") {
      if (ytPlayer && ytReady) {
        const d = ytPlayer.getDuration?.();
        if (isFinite(d)) mediaMs = d * 1000;
      }
    }
    durationMs = Math.max(mediaMs, lastEventTime);
    if (seek) {
      seek.max = String(durationMs || lastEventTime || 0);
      if (!seek.step) seek.step = "50";
      if (!seek.value) seek.value = "0";
      updateTimeLabel(seek.value);
    }
  }

  function resetEditorsEmpty() {
    if (txtRO) txtRO.value = "";
    if (txtEdit) txtEdit.value = "";
    render("");
    showED();
    appliedIdx = 0;
    appliedTime = 0;
    topCode = "";
    if (seek) { seek.value = "0"; updateTimeLabel(seek.value); }
    if (btnToggle) btnToggle.textContent = "▶ Play";
    if (btnPlay && btnPause) { btnPlay.disabled = false; btnPause.disabled = true; }
  }

  function applyForwardUntil(targetMs) {
    // Seek backward → rebuild from scratch
    if (targetMs < appliedTime - 1) {
      appliedIdx = 0;
      appliedTime = 0;
      topCode = initial || "";
    }
    while (appliedIdx < events.length && (events[appliedIdx].time || 0) <= targetMs) {
      topCode = applyChangeToText(topCode, events[appliedIdx].change || {});
      appliedIdx++;
    }
    appliedTime = targetMs;
    if (txtRO) txtRO.value = topCode;
  }

  function syncPreview() {
    if (!frame) return;
    if (playing) render(txtRO?.value || "");
    else         render(txtEdit?.value || "");
  }

  // ---------- Media selection ----------
  function clearMediaListeners() {
    if (mediaEl) {
      mediaEl.onloadedmetadata = null;
      mediaEl.ontimeupdate = null;
      mediaEl.onended = null;
    }
  }
  function showOnly(el) {
    const hide = (q) => {
      const n = root.querySelector(q);
      if (n) n.style.display = "none";
    };
    hide(".editorVideo");   // your <video> if present
    hide("video");          // fallback selector
    hide(".editorAudio");
    hide(".editorYouTube");
    if (el) el.style.display = ""; // show chosen media
  }

  async function setMedia(src, type) {
    mediaType = (type || "none").toLowerCase();

    // Clear previous
    clearMediaListeners();
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    ytPlayer = null; ytReady = false;
    mediaEl = null;

    if (!src || mediaType === "none") {
      showOnly(null);
      recalcDuration();
      setStatus("Timeline-only (no media).");
      return;
    }

    if (mediaType === "video") {
      const v = videoSlot || root.querySelector("video");
      if (!v) {
        console.warn("No <video> element found for this .menu_editor; falling back to timeline-only.");
        mediaType = "none";
        showOnly(null);
        recalcDuration();
        return;
      }
      v.src = src;
      v.controls = true;
      v.classList.add("editorVideo");
      mediaEl = v;
      showOnly(v);

      mediaEl.onloadedmetadata = () => {
        recalcDuration();
        setStatus(`Video loaded (${Math.round(mediaEl.duration)}s).`);
      };
      mediaEl.ontimeupdate = () => {
        if (!isFinite(mediaEl.duration)) return;
        const ms = mediaEl.currentTime * 1000;
        if (playing && seek) {
          seek.value = String(ms);
          updateTimeLabel(seek.value);
          applyForwardUntil(ms);
          syncPreview();
        }
      };
      mediaEl.onended = () => {
        pause(true);
        seekTo(durationMs);
      };
      recalcDuration();
      return;
    }

    if (mediaType === "audio") {
      // Create (or reuse) an <audio> element
      let aud = root.querySelector(".editorAudio");
      if (!aud) {
        aud = document.createElement("audio");
        aud.className = "editorAudio";
        aud.controls = true;
        aud.style.width = "100%";
        aud.style.display = "block";
        // Insert above read-only editor block for consistency
        (roWrap?.parentNode || root).insertBefore(aud, roWrap || root.firstChild);
      }
      aud.src = src;
      mediaEl = aud;
      showOnly(aud);

      mediaEl.onloadedmetadata = () => {
        recalcDuration();
        setStatus(`Audio loaded (${Math.round(mediaEl.duration)}s).`);
      };
      mediaEl.ontimeupdate = () => {
        if (!isFinite(mediaEl.duration)) return;
        const ms = mediaEl.currentTime * 1000;
        if (playing && seek) {
          seek.value = String(ms);
          updateTimeLabel(seek.value);
          applyForwardUntil(ms);
          syncPreview();
        }
      };
      mediaEl.onended = () => {
        pause(true);
        seekTo(durationMs);
      };
      recalcDuration();
      return;
    }

    if (mediaType === "youtube") {
      // Create (or reuse) a holder with guaranteed height/aspect
      let holder = root.querySelector(".editorYouTube");
      if (!holder) {
        holder = document.createElement("div");
        holder.className = "editorYouTube";
        holder.style.position = "relative";
        holder.style.width = "100%";
        holder.style.background = "#000";
        // Aspect-ratio fallback: 16:9 via padding
        holder.style.height = "0";
        holder.style.paddingTop = "56.25%"; // 9/16
        (roWrap?.parentNode || root).insertBefore(holder, roWrap || root.firstChild);
      }
      // Clear previous content (if any)
      holder.innerHTML = "";
      showOnly(holder);

      await loadYouTubeAPI();
      const vid = extractYouTubeId(src);

      // The API will inject an <iframe> that we position absolute to fill the holder
      const inner = document.createElement("div");
      inner.style.position = "absolute";
      inner.style.inset = "0";
      holder.appendChild(inner);

      ytPlayer = new YT.Player(inner, {
        videoId: vid,
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1, controls: 1 },
        events: {
          onReady: () => {
            ytReady = true;
            recalcDuration();
            setStatus("YouTube ready.");
          },
          onStateChange: (ev) => {
            if (ev.data === YT.PlayerState.ENDED) {
              pause(true);
              seekTo(durationMs);
            }
          }
        }
      });
      return;
    }

    // Unknown media type: fallback
    mediaType = "none";
    showOnly(null);
    recalcDuration();
  }

  // ---------- Playback ----------
  function play() {
    if (!events.length) {
      setStatus("Load a JSON recording first.");
      alert("Load a JSON recording first.");
      return;
    }
    if (playing) return;
    playing = true;
    if (btnToggle) btnToggle.textContent = "❚❚ Pause";
    if (btnPlay && btnPause) { btnPlay.disabled = true; btnPause.disabled = false; }

    // Align timeline to current seek
    const targetMs = Number(seek?.value || 0);
    applyForwardUntil(targetMs);
    if (txtEdit && txtRO) txtEdit.value = txtRO.value; // sync once (no branching)
    showRO(); // only read-only while playing
    syncPreview();
    setStatus(`Playing… (${appliedIdx}/${events.length})`);

    if (mediaType === "video" || mediaType === "audio") {
      if (mediaEl) {
        if (isFinite(mediaEl.duration)) mediaEl.currentTime = targetMs / 1000;
        mediaEl.play();
        return;
      }
    } else if (mediaType === "youtube") {
      if (ytPlayer && ytReady) {
        ytPlayer.seekTo(targetMs / 1000, true);
        ytPlayer.playVideo();
        const tick = () => {
          if (!playing) return;
          const cur = (ytPlayer.getCurrentTime?.() || 0) * 1000;
          const capped = Math.min(cur, Number(seek?.max || 0));
          if (seek) {
            seek.value = String(capped);
            updateTimeLabel(seek.value);
          }
          applyForwardUntil(capped);
          syncPreview();
          if (playing) rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
        return;
      }
    }

    // Fallback synthetic clock
    offsetMs = targetMs;
    startTs = performance.now();
    const tick = () => {
      const now = performance.now();
      const cur = offsetMs + (now - startTs);
      const capped = Math.min(cur, durationMs);
      if (seek) {
        seek.value = String(capped);
        updateTimeLabel(seek.value);
      }
      applyForwardUntil(capped);
      syncPreview();
      if (playing && capped < durationMs) {
        rafId = requestAnimationFrame(tick);
      } else {
        pause(true);
      }
    };
    rafId = requestAnimationFrame(tick);
  }

  function pause(silent = false) {
    if (!playing && !silent) {
      if (txtEdit && txtRO) txtEdit.value = txtRO.value;
      showED();
      syncPreview();
      setStatus("Paused.");
      return;
    }
    playing = false;
    if (btnToggle) btnToggle.textContent = "▶ Play";
    if (btnPlay && btnPause) { btnPlay.disabled = false; btnPause.disabled = true; }

    if (mediaType === "video" || mediaType === "audio") {
      if (mediaEl) mediaEl.pause();
    } else if (mediaType === "youtube") {
      if (ytPlayer?.pauseVideo) ytPlayer.pauseVideo();
    }
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }

    if (txtEdit && txtRO) txtEdit.value = txtRO.value;
    showED();
    syncPreview();
    if (!silent) setStatus("Paused.");
  }

  function resetKeepJson() {
    if (mediaType === "video" || mediaType === "audio") {
      if (mediaEl) { mediaEl.pause(); mediaEl.currentTime = 0; }
    } else if (mediaType === "youtube") {
      if (ytPlayer?.seekTo) ytPlayer.seekTo(0, true);
      if (ytPlayer?.pauseVideo) ytPlayer.pauseVideo();
    }
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    playing = false;
    appliedIdx = 0;
    appliedTime = 0;
    topCode = "";
    if (txtRO) txtRO.value = "";
    if (txtEdit) txtEdit.value = "";
    if (seek) { seek.value = "0"; updateTimeLabel(seek.value); }
    showED();
    render("");
    if (btnToggle) btnToggle.textContent = "▶ Play";
    if (btnPlay && btnPause) { btnPlay.disabled = false; btnPause.disabled = true; }
    setStatus(events.length ? "Reset. JSON loaded; press Play to start." : "Reset. No JSON loaded.");
  }

  // ---------- Seek ----------
  function seekTo(ms) {
    const max = Number(seek?.max || 0);
    ms = Math.max(0, Math.min(ms, max));
    if (seek) {
      seek.value = String(ms);
      updateTimeLabel(seek.value);
    }

    if (mediaType === "video" || mediaType === "audio") {
      if (mediaEl && isFinite(mediaEl.duration)) mediaEl.currentTime = ms / 1000;
    } else if (mediaType === "youtube") {
      if (ytPlayer?.seekTo) ytPlayer.seekTo(ms / 1000, true);
    }

    applyForwardUntil(ms);
    if (!playing && txtEdit && txtRO) {
      txtEdit.value = txtRO.value; // keep editable equal to latest top while paused
    }
    syncPreview();
  }

  // ---------- JSON loading ----------
  function loadData(data) {
    if (Array.isArray(data)) {
      events = data; initial = "";
    } else if (data && Array.isArray(data.events)) {
      events = data.events; initial = data.initial || "";
    } else {
      throw new Error("Unsupported JSON format.");
    }
    appliedIdx = 0; appliedTime = 0; topCode = initial || "";
    if (txtRO) txtRO.value = "";
    if (txtEdit) txtEdit.value = "";
    render("");
    showED(); // start paused view
    recalcDuration();
    setStatus(`Loaded ${events.length} events. Press Play.`);
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  // ---------- Wire UI ----------
  if (btnLoad && fileJson) {
    btnLoad.addEventListener("click", () => fileJson.click());
    fileJson.addEventListener("change", (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          loadData(data);
        } catch (err) {
          console.error(err);
          alert("Invalid JSON file.");
          setStatus("Invalid JSON file.");
        }
      };
      reader.readAsText(f);
      e.target.value = ""; // allow reselect same file later
    });
  }

  if (btnToggle) {
    btnToggle.addEventListener("click", () => (playing ? pause() : play()));
  } else if (btnPlay && btnPause) {
    btnPlay.addEventListener("click", play);
    btnPause.addEventListener("click", () => pause());
    btnPause.disabled = true; // initial
  }

  if (btnReset) btnReset.addEventListener("click", resetKeepJson);

  if (seek) {
    seek.addEventListener("input", (e) => {
      const v = Number(e.target.value || 0);
      seekTo(v);
    });
  }

  if (txtEdit) {
    txtEdit.addEventListener("input", () => {
      if (!playing) render(txtEdit.value);
    });
  }

  // Initial state
  resetEditorsEmpty();

  // Public API used by autoloader
  return {
    loadFromUrl: async (url) => {
      try {
        const data = await fetchJson(url);
        loadData(data);
      } catch (err) {
        setStatus(`Auto-load failed (${err.message}). Use “Load JSON…”.`);
      }
    },
    setMedia: (src, type) => { setMedia(src, type); },
    setVideoSrc: (src) => { setMedia(src, "video"); }, // legacy alias
    seekTo,
  };
}

// ===================== Boot =====================
document.addEventListener("DOMContentLoaded", () => {
  const editors = Array.from(document.querySelectorAll(".menu_editor")).map((el) =>
    createMiniPlayer(el)
  );

  // Apply AUTO_MAP autoloads: [json, nodeIndex, mediaUrl, mediaType]
  for (const entry of AUTO_MAP) {
    const [recSrc, nodeIndex, mediaUrl, mediaType] = entry;
    const idx = Number(nodeIndex) - 1;
    if (!editors[idx]) continue;
    if (mediaUrl && mediaType) editors[idx].setMedia(mediaUrl, mediaType);
    editors[idx].loadFromUrl(recSrc);
  }

  // Optional URL params like:
  //   ?src1=/a.json&media1=/video.mp4&type1=video
  //   ?src2=/b.json&media2=/audio.mp3&type2=audio
  //   ?src3=https://www.youtube.com/watch?v=...&type3=youtube
  const p = new URLSearchParams(location.search);
  editors.forEach((player, i) => {
    const k = i + 1;
    const src   = p.get(`src${k}`);
    const media = p.get(`media${k}`);
    const type  = p.get(`type${k}`);
    if (media && type) player.setMedia(media, type);
    if (src) player.loadFromUrl(src);
  });
});
