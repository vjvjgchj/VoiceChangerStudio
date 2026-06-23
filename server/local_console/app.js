const state = {
    info: null,
    activePreset: "balanced",
    theme: "anime",
    toastTimer: null,
    customPresets: [],
    modelTestingSlot: null,
    devices: {
        inputs: [],
        outputs: [],
    },
    audio: {
        running: false,
        inputMode: "mic",
        fileName: "",
        context: null,
        stream: null,
        source: null,
        socket: null,
        workletNode: null,
        outputGain: null,
        outputDestination: null,
        outputElement: null,
        pendingInput: new Float32Array(0),
        chunkSamples: 128 * 128,
        maxInFlight: 4,
        inFlight: 0,
        requestCount: 0,
        responseCount: 0,
        dropCount: 0,
        lastLatencyMs: null,
        outputBufferLevel: 0,
        volume: 0,
        autoCaptureFile: false,
        fileProgressTimer: null,
        fileDurationSec: 0,
        fileStartedAt: 0,
        fileElapsedSec: 0,
        fileProgress: 0,
        filePhase: "idle",
        fileCompleted: false,
    },
    recording: {
        loadedAt: null,
        currentRecord: null,
    },
    recordings: {
        items: [],
        loading: false,
        saving: false,
    },
    system: {
        status: null,
        checks: null,
        timer: null,
        initRetryTimer: null,
        initAttempts: 0,
        initializing: false,
        initialized: false,
        applyingDefaults: false,
        deferredModelLoading: false,
    },
    localSettings: null,
    uploading: false,
};

const detectors = ["dio", "harvest", "crepe", "crepe_full", "crepe_tiny", "rmvpe", "rmvpe_onnx", "fcpe"];
const chunks = [64, 80, 96, 112, 128, 192, 256, 320, 384, 448, 512, 576, 640, 704, 768, 832, 896, 960, 1024, 2048];
const extras = [4096, 8192, 12288, 16384, 32768, 65536, 131072];
const TARGET_SAMPLE_RATE = 48000;
const BASE_CHUNK_SIZE = 128;
const UPLOAD_CHUNK_SIZE = 1024 * 1024;
const CUSTOM_PRESETS_STORAGE_KEY = "vcb.localConsole.customPresets";
const LOCAL_SETTINGS_STORAGE_KEY = "vcb.localConsole.settings";
const THEME_STORAGE_KEY = "vcb.localConsole.theme";
const DEFAULT_THEME = "anime";
const themes = ["anime", "clean"];

const presets = [
    {
        id: "low",
        label: "低延迟",
        description: "聊天/直播优先",
        settings: {
            f0Detector: "rmvpe_onnx",
            serverReadChunkSize: 96,
            extraConvertSize: 8192,
            indexRatio: 0.15,
            protect: 0.5,
            silentThreshold: 0.00018,
        },
    },
    {
        id: "balanced",
        label: "平衡",
        description: "默认推荐",
        settings: {
            f0Detector: "rmvpe_onnx",
            serverReadChunkSize: 128,
            extraConvertSize: 8192,
            indexRatio: 0.2,
            protect: 0.5,
            silentThreshold: 0.00018,
        },
    },
    {
        id: "quality",
        label: "高质量",
        description: "更稳，延迟稍高",
        settings: {
            f0Detector: "rmvpe_onnx",
            serverReadChunkSize: 192,
            extraConvertSize: 16384,
            indexRatio: 0.25,
            protect: 0.5,
            silentThreshold: 0.00018,
        },
    },
    {
        id: "noise",
        label: "强降噪",
        description: "环境噪声较大",
        settings: {
            f0Detector: "rmvpe_onnx",
            serverReadChunkSize: 128,
            extraConvertSize: 12288,
            indexRatio: 0.2,
            protect: 0.55,
            silentThreshold: 0.00022,
        },
    },
];

const $ = (id) => document.getElementById(id);

const clampText = (value, fallback = "-") => {
    if (value === undefined || value === null || value === "") {
        return fallback;
    }
    return String(value);
};

const showToast = (message) => {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 2600);
};

const extensionOf = (file) => {
    return (file?.name || "").split(".").pop().toLowerCase();
};

const isAllowedExtension = (file, allowed) => {
    return Boolean(file && allowed.includes(extensionOf(file)));
};

const concatFloat32 = (first, second) => {
    if (!first.length) {
        return second;
    }
    const output = new Float32Array(first.length + second.length);
    output.set(first, 0);
    output.set(second, first.length);
    return output;
};

const downsampleBuffer = (buffer, sourceRate, targetRate) => {
    if (sourceRate === targetRate) {
        return buffer;
    }
    if (sourceRate < targetRate) {
        return buffer;
    }
    const ratio = sourceRate / targetRate;
    const newLength = Math.max(1, Math.round(buffer.length / ratio));
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
        const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
        let accum = 0;
        let count = 0;
        for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i += 1) {
            accum += buffer[i];
            count += 1;
        }
        result[offsetResult] = count ? accum / count : 0;
        offsetResult += 1;
        offsetBuffer = nextOffsetBuffer;
    }
    return result;
};

const floatToInt16Bytes = (floatData) => {
    const view = new DataView(new ArrayBuffer(floatData.length * 2));
    for (let i = 0; i < floatData.length; i += 1) {
        const sample = Math.max(-1, Math.min(1, floatData[i]));
        view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return new Uint8Array(view.buffer);
};

const int16BytesToFloat = (arrayBuffer) => {
    const int16 = new Int16Array(arrayBuffer);
    const floatData = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i += 1) {
        floatData[i] = int16[i] < 0 ? int16[i] / 0x8000 : int16[i] / 0x7fff;
    }
    return floatData;
};

const normalizeFilename = (file) => {
    return (file?.name || "").replace(/[\\/:*?"<>|]/g, "_");
};

const fetchInfo = async () => {
    const response = await fetch("/info", { cache: "no-store" });
    if (!response.ok) {
        throw new Error(`读取 /info 失败: ${response.status}`);
    }
    state.info = await response.json();
    render();
    return state.info;
};

const updateSetting = async (key, val, silent = false) => {
    const form = new FormData();
    form.append("key", key);
    form.append("val", String(val));
    const response = await fetch("/update_settings", {
        method: "POST",
        body: form,
    });
    if (!response.ok) {
        throw new Error(`更新 ${key} 失败: ${response.status}`);
    }
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
        state.info = await response.json();
    } else {
        await fetchInfo();
    }
    render();
    if (!silent) {
        showToast("设置已更新");
    }
};

const getAudioInputMode = () => {
    return document.querySelector('input[name="audioInputMode"]:checked')?.value || "mic";
};

const selectedInputFile = () => {
    return $("audioInputFile").files?.[0] || null;
};

const shouldAutoSaveFileResult = () => {
    return $("autoSaveFileResult")?.checked ?? true;
};

const formatFileMeta = (file) => {
    if (!file) {
        return "未选择文件";
    }
    const sizeMb = file.size / 1024 / 1024;
    return `${file.name} / ${sizeMb.toFixed(sizeMb >= 10 ? 0 : 1)} MB`;
};

const formatDuration = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return "--:--";
    }
    const total = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(total / 60);
    const secs = total % 60;
    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
};

const loadCustomPresets = () => {
    try {
        const raw = localStorage.getItem(CUSTOM_PRESETS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed
            .filter((preset) => preset && preset.id && preset.label && preset.settings)
            .map((preset) => ({ ...preset, custom: true }));
    } catch (_error) {
        return [];
    }
};

const persistCustomPresets = () => {
    localStorage.setItem(CUSTOM_PRESETS_STORAGE_KEY, JSON.stringify(state.customPresets));
};

const allPresets = () => [...presets, ...state.customPresets];

const loadTheme = () => {
    try {
        const value = localStorage.getItem(THEME_STORAGE_KEY);
        return themes.includes(value) ? value : DEFAULT_THEME;
    } catch (_error) {
        return DEFAULT_THEME;
    }
};

const persistTheme = (theme) => {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
};

const applyTheme = (theme) => {
    const nextTheme = themes.includes(theme) ? theme : DEFAULT_THEME;
    state.theme = nextTheme;
    document.body.dataset.theme = nextTheme;
    const select = $("themeSelect");
    if (select) {
        select.value = nextTheme;
    }
};

const currentPresetSettings = () => ({
    tran: Number($("tune")?.value ?? state.info?.tran ?? 0),
    f0Detector: $("f0Detector")?.value || state.info?.f0Detector || "rmvpe_onnx",
    serverReadChunkSize: Number($("serverReadChunkSize")?.value || state.info?.serverReadChunkSize || 128),
    extraConvertSize: Number($("extraConvertSize")?.value || state.info?.extraConvertSize || 8192),
    indexRatio: Number($("indexRatio")?.value ?? state.info?.indexRatio ?? 0),
    protect: Number($("protect")?.value ?? state.info?.protect ?? 0.5),
    silentThreshold: Number($("silentThreshold")?.value ?? state.info?.silentThreshold ?? 0),
});

const defaultLocalSettings = () => ({
    inputDeviceId: "",
    outputDeviceId: "",
    modelSlotIndex: "",
    autoSaveFileResult: true,
    params: null,
});

const loadLocalSettings = () => {
    try {
        const raw = localStorage.getItem(LOCAL_SETTINGS_STORAGE_KEY);
        return { ...defaultLocalSettings(), ...(raw ? JSON.parse(raw) : {}) };
    } catch (_error) {
        return defaultLocalSettings();
    }
};

const persistLocalSettings = () => {
    localStorage.setItem(LOCAL_SETTINGS_STORAGE_KEY, JSON.stringify(state.localSettings));
};

const updateLocalSettings = (patch) => {
    state.localSettings = { ...defaultLocalSettings(), ...(state.localSettings || {}), ...patch };
    persistLocalSettings();
    renderSettingsCenter();
};

const captureCurrentDefaults = () => {
    const currentSlot = Number(state.info?.modelSlotIndex);
    state.localSettings = {
        inputDeviceId: $("audioInputSelect")?.value || "",
        outputDeviceId: $("audioOutputSelect")?.value || "",
        modelSlotIndex: Number.isInteger(currentSlot) && currentSlot >= 0 ? currentSlot : "",
        autoSaveFileResult: shouldAutoSaveFileResult(),
        params: currentPresetSettings(),
    };
    persistLocalSettings();
    renderSettingsCenter();
    showToast("已保存启动默认");
};

const escapeHtml = (value) => {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    }[char]));
};

const apiErrorMessage = async (response, fallback) => {
    try {
        const body = await response.json();
        return body?.detail?.error?.message || body?.error?.message || body?.detail?.message || fallback;
    } catch (_error) {
        return fallback;
    }
};

const formatBytes = (bytes) => {
    const value = Number(bytes || 0);
    if (value >= 1024 * 1024) {
        return `${(value / 1024 / 1024).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
    }
    if (value >= 1024) {
        return `${Math.round(value / 1024)} KB`;
    }
    return `${value} B`;
};

const formatMaybeBytes = (bytes) => {
    const value = Number(bytes);
    return Number.isFinite(value) && value > 0 ? formatBytes(value) : "-";
};

const formatRecordTime = (value) => {
    if (!value) {
        return "-";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleString("zh-CN", { hour12: false });
};

const cacheUrl = (url) => {
    return `${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}`;
};

const defaultModelSlotToLoad = () => {
    const localSlot = state.localSettings?.modelSlotIndex;
    if (localSlot !== undefined && localSlot !== null && localSlot !== "") {
        const slot = Number(localSlot);
        return Number.isInteger(slot) && slot >= 0 ? slot : null;
    }
    const infoSlot = Number(state.info?.modelSlotIndex);
    return Number.isInteger(infoSlot) && infoSlot >= 0 ? infoSlot : null;
};

const ensureModelLoaded = async (slot = defaultModelSlotToLoad(), silent = false) => {
    if (state.info?.modelLoaded !== false && (slot === null || String(state.info?.modelSlotIndex) === String(slot))) {
        return true;
    }
    if (slot === null) {
        showToast("请先选择模型");
        return false;
    }
    state.system.deferredModelLoading = true;
    renderCurrentModel();
    renderSystemStatus();
    if (!silent) {
        setAudioStatus("正在加载模型");
    }
    try {
        await updateSetting("modelSlotIndex", slot, true);
        await fetchSystemStatus(true);
        return true;
    } finally {
        state.system.deferredModelLoading = false;
        renderCurrentModel();
        renderSystemStatus();
    }
};

const loadDeferredModelAfterStartup = () => {
    const slot = defaultModelSlotToLoad();
    if (slot === null || state.info?.modelLoaded !== false || state.system.deferredModelLoading) {
        return;
    }
    showToast("后端已启动，正在后台加载上次模型");
    ensureModelLoaded(slot, true)
        .then((loaded) => {
            if (loaded) {
                showToast("模型加载完成");
            }
        })
        .catch((error) => showToast(`模型后台加载失败：${error.message}`));
};

const fetchSystemStatus = async (silent = false) => {
    try {
        const response = await fetch("/api/local/system/status", { cache: "no-store" });
        if (!response.ok) {
            throw new Error(await apiErrorMessage(response, `读取运行状态失败: ${response.status}`));
        }
        state.system.status = await response.json();
    } catch (error) {
        state.system.status = null;
        if (!silent) {
            showToast(error.message);
        }
    }
    renderSystemStatus();
};

const fetchStartupChecks = async (silent = false) => {
    try {
        const response = await fetch("/api/local/system/checks", { cache: "no-store" });
        if (!response.ok) {
            throw new Error(await apiErrorMessage(response, `首启动检查失败: ${response.status}`));
        }
        state.system.checks = await response.json();
    } catch (error) {
        state.system.checks = null;
        if (!silent) {
            showToast(error.message);
        }
    }
    renderStartupChecks();
};

const refreshSystem = async (silent = false) => {
    await Promise.all([fetchSystemStatus(silent), fetchStartupChecks(silent)]);
};

const startSystemPolling = () => {
    if (state.system.timer) {
        window.clearInterval(state.system.timer);
    }
    state.system.timer = window.setInterval(() => {
        fetchSystemStatus(true);
    }, 5000);
};

const stopInitRetry = () => {
    if (state.system.initRetryTimer) {
        window.clearInterval(state.system.initRetryTimer);
        state.system.initRetryTimer = null;
    }
};

const startInitRetry = () => {
    if (state.system.initialized || state.system.initRetryTimer) {
        return;
    }
    state.system.initRetryTimer = window.setInterval(() => {
        initialize(true);
    }, 3000);
};

const recordingSourceLabel = (record) => {
    if (record.sourceType === "file") {
        return record.sourceName ? `文件：${record.sourceName}` : "文件转换";
    }
    return record.sourceName ? `录音：${record.sourceName}` : "实时录音";
};

const currentRecordingSource = (fallbackType = null, fallbackName = "") => {
    const file = selectedInputFile();
    const type = fallbackType || (getAudioInputMode() === "file" ? "file" : "recording");
    const name = fallbackName || (type === "file" ? (state.audio.fileName || file?.name || "") : "");
    return { type, name };
};

const recordUrl = (name, stamp = state.recording.loadedAt || Date.now()) => {
    return `/tmp/${name}.wav?${stamp}`;
};

const setElementSink = async (element, sinkId) => {
    if (element?.setSinkId && sinkId) {
        await element.setSinkId(sinkId);
    }
};

const setHistoryAudioSinks = async () => {
    const sinkId = $("audioOutputSelect")?.value;
    await Promise.all(
        Array.from(document.querySelectorAll("#recordHistoryList audio")).map((element) => setElementSink(element, sinkId)),
    );
};

const loadRecordings = async (silent = false) => {
    state.recordings.loading = true;
    renderRecordings();
    try {
        const response = await fetch("/api/local/recordings", { cache: "no-store" });
        if (!response.ok) {
            throw new Error(await apiErrorMessage(response, `读取历史记录失败: ${response.status}`));
        }
        const body = await response.json();
        state.recordings.items = Array.isArray(body.data) ? body.data : [];
    } catch (error) {
        if (!silent) {
            showToast(error.message);
        }
    } finally {
        state.recordings.loading = false;
        renderRecordings();
    }
};

const loadRecordingPlayers = async (record = null) => {
    const stamp = Date.now();
    state.recording.loadedAt = stamp;
    state.recording.currentRecord = record;
    const inputUrl = record ? cacheUrl(record.inputUrl) : recordUrl("in", stamp);
    const outputUrl = record ? cacheUrl(record.outputUrl) : recordUrl("out", stamp);
    const sinkId = $("audioOutputSelect").value;

    $("recordInputAudio").src = inputUrl;
    $("recordOutputAudio").src = outputUrl;
    $("downloadInputRecord").href = inputUrl;
    $("downloadOutputRecord").href = outputUrl;
    $("downloadInputRecord").download = record ? `${record.id}-input.wav` : "input.wav";
    $("downloadOutputRecord").download = record ? `${record.id}-output.wav` : "output.wav";

    try {
        await Promise.all([
            setElementSink($("recordInputAudio"), sinkId),
            setElementSink($("recordOutputAudio"), sinkId),
        ]);
    } catch (error) {
        showToast(`录音播放设备切换失败：${error.message}`);
    }
    renderRecording();
};

const saveLatestRecording = async ({ sourceType = null, sourceName = "", title = "", toastMessage = "已保存到历史记录" } = {}) => {
    state.recordings.saving = true;
    renderRecording();
    try {
        const source = currentRecordingSource(sourceType, sourceName);
        const model = selectedModel();
        const form = new FormData();
        form.append("title", title);
        form.append("sourceType", source.type);
        form.append("sourceName", source.name);
        form.append("modelName", model?.name || "");
        form.append("tune", String(state.info?.tran ?? $("tune")?.value ?? ""));
        const response = await fetch("/api/local/recordings", {
            method: "POST",
            body: form,
        });
        if (!response.ok) {
            throw new Error(await apiErrorMessage(response, `保存历史记录失败: ${response.status}`));
        }
        const record = await response.json();
        await loadRecordings(true);
        await loadRecordingPlayers(record);
        showToast(toastMessage);
        return record;
    } finally {
        state.recordings.saving = false;
        renderRecording();
    }
};

const renameRecording = async (recordingId, title) => {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
        showToast("名称不能为空");
        return;
    }
    const form = new FormData();
    form.append("title", cleanTitle);
    const response = await fetch(`/api/local/recordings/${encodeURIComponent(recordingId)}`, {
        method: "PATCH",
        body: form,
    });
    if (!response.ok) {
        throw new Error(await apiErrorMessage(response, `重命名失败: ${response.status}`));
    }
    await loadRecordings(true);
    showToast("已重命名");
};

const deleteRecording = async (recordingId) => {
    if (!window.confirm("删除这条历史记录？")) {
        return;
    }
    const response = await fetch(`/api/local/recordings/${encodeURIComponent(recordingId)}`, {
        method: "DELETE",
    });
    if (!response.ok) {
        throw new Error(await apiErrorMessage(response, `删除失败: ${response.status}`));
    }
    if (state.recording.currentRecord?.id === recordingId) {
        state.recording.currentRecord = null;
        state.recording.loadedAt = null;
    }
    await loadRecordings(true);
    showToast("已删除");
};

const openRecordingFolder = async (recordingId) => {
    const response = await fetch(`/api/local/recordings/${encodeURIComponent(recordingId)}/open-folder`, {
        method: "POST",
    });
    if (!response.ok) {
        throw new Error(await apiErrorMessage(response, `打开文件夹失败: ${response.status}`));
    }
    showToast("已打开所在文件夹");
};

const clearFileProgressTimer = () => {
    if (state.audio.fileProgressTimer) {
        window.clearInterval(state.audio.fileProgressTimer);
        state.audio.fileProgressTimer = null;
    }
};

const resetFileProgress = (phase = "idle") => {
    clearFileProgressTimer();
    state.audio.fileDurationSec = 0;
    state.audio.fileStartedAt = 0;
    state.audio.fileElapsedSec = 0;
    state.audio.fileProgress = 0;
    state.audio.filePhase = phase;
    state.audio.fileCompleted = false;
    renderFileProgress();
};

const renderFileProgress = () => {
    const panel = $("fileProgressPanel");
    if (!panel) {
        return;
    }
    const mode = getAudioInputMode();
    const file = selectedInputFile();
    const hasFile = mode === "file" && Boolean(file);
    panel.hidden = !hasFile;
    if (!hasFile) {
        return;
    }

    const duration = state.audio.fileDurationSec || 0;
    const elapsed = Math.min(duration || state.audio.fileElapsedSec, state.audio.fileElapsedSec || 0);
    const progress = Math.max(0, Math.min(1, state.audio.fileProgress || 0));
    const percent = Math.round(progress * 100);
    const remaining = duration ? Math.max(0, duration - elapsed) : null;
    const phaseLabels = {
        idle: "等待开始转换",
        decoding: "正在解码音频",
        running: "正在转换文件",
        flushing: "文件播放结束，等待输出",
        complete: "转换完成",
        stopped: "已停止",
        error: "转换失败",
    };

    $("fileProgressLabel").textContent = phaseLabels[state.audio.filePhase] || "等待开始转换";
    $("fileProgressPercent").textContent = `${percent}%`;
    $("fileProgressBar").value = percent;
    $("fileElapsed").textContent = duration ? `${formatDuration(elapsed)} / ${formatDuration(duration)}` : formatDuration(elapsed);
    $("fileRemaining").textContent = remaining === null ? "剩余 --:--" : `剩余 ${formatDuration(remaining)}`;
};

const startFileProgressTimer = () => {
    clearFileProgressTimer();
    renderFileProgress();
    state.audio.fileProgressTimer = window.setInterval(() => {
        const audio = state.audio;
        if (!audio.running || audio.inputMode !== "file" || !audio.context) {
            clearFileProgressTimer();
            return;
        }
        const duration = audio.fileDurationSec || 0;
        const elapsed = Math.max(0, audio.context.currentTime - audio.fileStartedAt);
        audio.fileElapsedSec = duration ? Math.min(duration, elapsed) : elapsed;
        audio.fileProgress = duration ? Math.min(1, audio.fileElapsedSec / duration) : 0;
        renderFileProgress();
    }, 250);
};

const renderAudioInputMode = () => {
    const mode = getAudioInputMode();
    const running = state.audio.running;
    document.querySelectorAll('input[name="audioInputMode"]').forEach((input) => {
        input.disabled = running;
    });
    $("micInputField").hidden = mode !== "mic";
    $("fileInputField").hidden = mode !== "file";
    $("audioInputSelect").disabled = running || mode !== "mic";
    $("audioInputFile").disabled = running || mode !== "file";
    $("autoSaveFileResult").disabled = running || mode !== "file";
    $("audioFileStatus").textContent = formatFileMeta(selectedInputFile());
    renderFileProgress();
};

const renderRecordings = () => {
    const list = $("recordHistoryList");
    const status = $("recordHistoryStatus");
    if (!list || !status) {
        return;
    }

    if (state.recordings.loading) {
        status.textContent = "正在读取历史记录";
        list.innerHTML = `<div class="empty-state">正在加载...</div>`;
        return;
    }

    const records = state.recordings.items;
    status.textContent = records.length ? `${records.length} 条结果` : "暂无历史结果";
    if (!records.length) {
        list.innerHTML = `<div class="empty-state">还没有保存结果。录音停止后会自动入库，文件输入转换结束后也会自动保存。</div>`;
        return;
    }

    list.innerHTML = "";
    records.forEach((record) => {
        const item = document.createElement("article");
        item.className = "history-item";
        item.dataset.recordingId = record.id;
        const inputUrl = cacheUrl(record.inputUrl);
        const outputUrl = cacheUrl(record.outputUrl);
        item.innerHTML = `
            <div class="history-main">
                <label>
                    <span>名称</span>
                    <input class="history-title-input" type="text" value="${escapeHtml(record.title || record.id)}" aria-label="历史记录名称">
                </label>
                <div class="history-meta">
                    <span>${escapeHtml(formatRecordTime(record.createdAt))}</span>
                    <span>${escapeHtml(recordingSourceLabel(record))}</span>
                    <span>${escapeHtml(record.modelName || "未记录模型")}</span>
                    <span>Tune ${escapeHtml(record.tune || "-")}</span>
                    <span>${formatBytes(record.outputSize || 0)}</span>
                </div>
            </div>
            <div class="history-audio-grid">
                <label>
                    <span>输入原音</span>
                    <audio controls preload="none" src="${inputUrl}"></audio>
                </label>
                <label>
                    <span>变声输出</span>
                    <audio controls preload="none" src="${outputUrl}"></audio>
                </label>
            </div>
            <div class="history-actions">
                <button type="button" data-action="rename">重命名</button>
                <button type="button" data-action="open">打开文件夹</button>
                <a class="button secondary" href="${outputUrl}" download="${escapeHtml(record.id)}-output.wav">导出输出 WAV</a>
                <button class="danger-button" type="button" data-action="delete">删除</button>
            </div>
        `;
        item.querySelector('[data-action="rename"]').addEventListener("click", () => {
            const title = item.querySelector(".history-title-input").value;
            renameRecording(record.id, title).catch((error) => showToast(error.message));
        });
        item.querySelector('[data-action="open"]').addEventListener("click", () => {
            openRecordingFolder(record.id).catch((error) => showToast(error.message));
        });
        item.querySelector('[data-action="delete"]').addEventListener("click", () => {
            deleteRecording(record.id).catch((error) => showToast(error.message));
        });
        item.querySelectorAll("audio").forEach((audio) => {
            setElementSink(audio, $("audioOutputSelect")?.value).catch(() => {});
        });
        list.appendChild(item);
    });
};

const renderRecording = () => {
    const active = Number(state.info?.recordIO || 0) === 1;
    const saving = state.recordings.saving;
    $("startRecordButton").disabled = active || saving;
    $("stopRecordButton").disabled = !active || saving;
    $("recordResults").hidden = !state.recording.loadedAt;

    if (saving) {
        $("recordingStatus").textContent = "正在保存到历史记录...";
    } else if (active) {
        $("recordingStatus").textContent = "录音中：正在写入输入 in.wav 和输出 out.wav。";
    } else if (state.recording.loadedAt) {
        if (state.recording.currentRecord) {
            $("recordingStatus").textContent = "已保存到历史记录，可试听或导出。";
            return;
        }
        $("recordingStatus").textContent = "已加载最近录音，可试听或下载。";
    } else {
        $("recordingStatus").textContent = "保存输入与输出 WAV，停止后可试听和下载。";
    }
};

const loadTmpRecordingPlayers = async () => {
    const stamp = Date.now();
    state.recording.loadedAt = stamp;
    const inputUrl = recordUrl("in", stamp);
    const outputUrl = recordUrl("out", stamp);
    const sinkId = $("audioOutputSelect").value;

    $("recordInputAudio").src = inputUrl;
    $("recordOutputAudio").src = outputUrl;
    $("downloadInputRecord").href = inputUrl;
    $("downloadOutputRecord").href = outputUrl;

    try {
        await Promise.all([
            setElementSink($("recordInputAudio"), sinkId),
            setElementSink($("recordOutputAudio"), sinkId),
        ]);
    } catch (error) {
        showToast(`录音播放设备切换失败：${error.message}`);
    }
    renderRecording();
};

const startRecording = async () => {
    state.recording.loadedAt = null;
    state.recording.currentRecord = null;
    await updateSetting("recordIO", 1, true);
    showToast(state.audio.running ? "录音已开始" : "录音已准备，开始输入后写入");
    renderRecording();
};

const stopRecording = async () => {
    await updateSetting("recordIO", 0, true);
    await saveLatestRecording({ toastMessage: "录音已保存到历史记录" });
    return;
    showToast("录音已停止并加载");
};

const loadSampleModel = async (sample, slot) => {
    const form = new FormData();
    form.append("slot", String(slot));
    form.append("isHalf", "true");
    form.append(
        "params",
        JSON.stringify({
            voiceChangerType: sample.voiceChangerType,
            slot,
            isSampleMode: true,
            sampleId: sample.id,
            files: [],
            params: sample.voiceChangerType === "RVC" ? { useIndex: true } : {},
        }),
    );
    const response = await fetch("/load_model", {
        method: "POST",
        body: form,
    });
    if (!response.ok) {
        throw new Error(`下载样例失败: ${response.status}`);
    }
    showToast("样例模型下载完成");
    await fetchInfo();
};

const uploadFileChunked = async (file, storedName, onProgress) => {
    const chunkCount = Math.max(1, Math.ceil(file.size / UPLOAD_CHUNK_SIZE));
    for (let index = 0; index < chunkCount; index += 1) {
        const chunk = file.slice(index * UPLOAD_CHUNK_SIZE, (index + 1) * UPLOAD_CHUNK_SIZE);
        const form = new FormData();
        form.append("file", chunk);
        form.append("filename", `${storedName}_${index}`);
        const response = await fetch("/upload_file", {
            method: "POST",
            body: form,
        });
        if (!response.ok) {
            throw new Error(`上传 ${file.name} 失败: ${response.status}`);
        }
        onProgress?.((index + 1) / (chunkCount + 1));
    }

    const concatForm = new FormData();
    concatForm.append("filename", storedName);
    concatForm.append("filenameChunkNum", String(chunkCount));
    const concatResponse = await fetch("/concat_uploaded_file", {
        method: "POST",
        body: concatForm,
    });
    if (!concatResponse.ok) {
        throw new Error(`合并 ${file.name} 失败: ${concatResponse.status}`);
    }
    onProgress?.(1);
};

const loadUploadedRVCModel = async (slot, modelName, indexName) => {
    const files = [{ name: modelName, kind: "rvcModel", dir: "" }];
    if (indexName) {
        files.push({ name: indexName, kind: "rvcIndex", dir: "" });
    }

    const form = new FormData();
    form.append("slot", String(slot));
    form.append("isHalf", "true");
    form.append(
        "params",
        JSON.stringify({
            voiceChangerType: "RVC",
            slot,
            isSampleMode: false,
            sampleId: null,
            files,
            params: {},
        }),
    );

    const response = await fetch("/load_model", {
        method: "POST",
        body: form,
    });
    if (!response.ok) {
        throw new Error(`加载模型失败: ${response.status}`);
    }
};

const uploadRVCModel = async () => {
    if (state.uploading) {
        return;
    }

    const modelFile = $("uploadModelFile").files[0];
    const indexFile = $("uploadIndexFile").files[0];
    const slot = Number($("uploadSlot").value);
    if (!Number.isFinite(slot)) {
        showToast("请选择目标槽位");
        return;
    }
    if (!isAllowedExtension(modelFile, ["onnx", "pth"])) {
        showToast("请选择 .onnx 或 .pth 模型文件");
        return;
    }
    if (indexFile && !isAllowedExtension(indexFile, ["index", "bin"])) {
        showToast("索引文件只支持 .index 或 .bin");
        return;
    }

    state.uploading = true;
    $("uploadModelButton").disabled = true;
    const uploadStatus = $("uploadStatus");
    const modelName = normalizeFilename(modelFile);
    const indexName = indexFile ? normalizeFilename(indexFile) : "";

    try {
        uploadStatus.textContent = `上传模型文件 0%`;
        await uploadFileChunked(modelFile, modelName, (progress) => {
            uploadStatus.textContent = `上传模型文件 ${Math.round(progress * 100)}%`;
        });

        if (indexFile) {
            uploadStatus.textContent = `上传索引文件 0%`;
            await uploadFileChunked(indexFile, indexName, (progress) => {
                uploadStatus.textContent = `上传索引文件 ${Math.round(progress * 100)}%`;
            });
        }

        uploadStatus.textContent = "正在加载模型";
        await loadUploadedRVCModel(slot, modelName, indexName);
        if ($("activateUploadedModel").checked) {
            await updateSetting("modelSlotIndex", slot, true);
        }
        await fetchInfo();
        $("uploadForm").reset();
        $("activateUploadedModel").checked = true;
        uploadStatus.textContent = "上传完成";
        showToast(`已上传到 Slot ${slot}`);
    } catch (error) {
        uploadStatus.textContent = error.message;
        showToast(error.message);
    } finally {
        state.uploading = false;
        $("uploadModelButton").disabled = false;
        renderUploadSlots();
    }
};

const renderAudioMetrics = () => {
    $("audioRequestCount").textContent = String(state.audio.requestCount);
    $("audioResponseCount").textContent = String(state.audio.responseCount);
    $("audioDropCount").textContent = String(state.audio.dropCount);
    $("audioLatency").textContent = state.audio.lastLatencyMs === null ? "-" : `${state.audio.lastLatencyMs} ms`;
    $("audioBufferLevel").textContent = `${state.audio.outputBufferLevel} blocks`;
    $("audioVolume").textContent = `${Math.round(Math.min(1, state.audio.volume) * 100)}%`;
    $("audioTransport").textContent = state.audio.running ? "Socket.IO 已连接 / AudioWorklet 运行中" : "Socket.IO / AudioWorklet";
};

const setAudioStatus = (message) => {
    $("audioStatus").textContent = message;
};

const populateDeviceSelect = (selectId, devices, fallbackLabel, selectedValue = null) => {
    const select = $(selectId);
    if (!select) {
        return;
    }
    const previous = selectedValue === null ? select.value : selectedValue;
    select.innerHTML = "";

    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = fallbackLabel;
    select.appendChild(defaultOption);

    devices.forEach((device, index) => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.textContent = device.label || `${fallbackLabel} ${index + 1}`;
        select.appendChild(option);
    });

    if (previous !== null && Array.from(select.options).some((option) => option.value === String(previous))) {
        select.value = previous;
    }
};

const refreshBrowserDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
        setAudioStatus("浏览器不支持设备枚举");
        return;
    }

    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        state.devices.inputs = devices.filter((device) => device.kind === "audioinput");
        state.devices.outputs = devices.filter((device) => device.kind === "audiooutput");
        populateDeviceSelect("audioInputSelect", state.devices.inputs, "默认麦克风");
        populateDeviceSelect("audioOutputSelect", state.devices.outputs, "默认输出");
        renderSystemStatus();
        renderSettingsCenter();
    } catch (error) {
        showToast(`读取音频设备失败：${error.message}`);
    }
};

const handleSocketResponse = (response) => {
    const audio = state.audio;
    if (!audio.running || !audio.workletNode) {
        return;
    }

    const [timestamp, buffer] = response;
    audio.inFlight = Math.max(0, audio.inFlight - 1);
    audio.responseCount += 1;
    audio.lastLatencyMs = Date.now() - Number(timestamp);

    if (!buffer || buffer.byteLength < BASE_CHUNK_SIZE * 2) {
        audio.dropCount += 1;
        renderAudioMetrics();
        return;
    }

    const converted = int16BytesToFloat(buffer);
    audio.workletNode.port.postMessage({
        requestType: "voice",
        voice: converted,
    });
    renderAudioMetrics();
};

const processAudioChunk = (chunk) => {
    const audio = state.audio;
    if (!audio.running || !audio.socket) {
        return;
    }
    if (audio.inFlight >= audio.maxInFlight) {
        audio.dropCount += 1;
        renderAudioMetrics();
        return;
    }

    try {
        const timestamp = Date.now();
        const bytes = floatToInt16Bytes(chunk);
        audio.socket.sendRequest(timestamp, bytes.buffer);
        audio.inFlight += 1;
        audio.requestCount += 1;
        renderAudioMetrics();
    } catch (error) {
        audio.dropCount += 1;
        showToast(error.message);
        renderAudioMetrics();
    }
};

const handleInputAudio = (inputData) => {
    const audio = state.audio;
    if (!audio.running || !audio.context) {
        return;
    }

    const downsampled = downsampleBuffer(inputData, audio.context.sampleRate, TARGET_SAMPLE_RATE);
    audio.pendingInput = concatFloat32(audio.pendingInput, downsampled);

    while (audio.pendingInput.length >= audio.chunkSamples) {
        const chunk = audio.pendingInput.slice(0, audio.chunkSamples);
        audio.pendingInput = audio.pendingInput.slice(audio.chunkSamples);
        processAudioChunk(chunk);
        if (audio.inFlight >= audio.maxInFlight) {
            break;
        }
    }
};

const handleWorkletMessage = (event) => {
    const data = event.data;
    if (!data || !data.responseType) {
        return;
    }
    if (data.responseType === "inputData" && data.inputData) {
        handleInputAudio(new Float32Array(data.inputData));
    } else if (data.responseType === "volume") {
        state.audio.volume = data.volume || 0;
        state.audio.outputBufferLevel = data.blocks ?? state.audio.outputBufferLevel;
        renderAudioMetrics();
    } else if (data.responseType === "buffer") {
        state.audio.outputBufferLevel = data.blocks || 0;
        renderAudioMetrics();
    }
};

const stopAudio = async () => {
    const audio = state.audio;
    const shouldSaveFileCapture = audio.autoCaptureFile;
    const fileCaptureName = audio.fileName;
    const wasFileMode = audio.inputMode === "file";
    const fileCompleted = wasFileMode && (audio.fileCompleted || audio.fileProgress >= 0.98);
    clearFileProgressTimer();
    audio.running = false;
    $("startAudioButton").disabled = false;
    $("stopAudioButton").disabled = true;
    setAudioStatus("已停止");

    audio.socket?.close();
    audio.workletNode?.port.postMessage({ requestType: "stop" });
    audio.workletNode?.disconnect();
    if (audio.source?.stop) {
        try {
            audio.source.stop(0);
        } catch (_error) {
            // The source may already have ended.
        }
    }
    if (audio.source) {
        audio.source.disconnect();
    }
    if (audio.outputGain) {
        audio.outputGain.disconnect();
    }
    if (audio.stream) {
        audio.stream.getTracks().forEach((track) => track.stop());
    }
    if (audio.outputElement) {
        audio.outputElement.pause();
        audio.outputElement.srcObject = null;
        audio.outputElement.remove();
    }
    if (audio.context && audio.context.state !== "closed") {
        await audio.context.close();
    }

    state.audio = {
        ...state.audio,
        running: false,
        context: null,
        stream: null,
        source: null,
        socket: null,
        workletNode: null,
        outputGain: null,
        outputDestination: null,
        outputElement: null,
        pendingInput: new Float32Array(0),
        inFlight: 0,
        outputBufferLevel: 0,
        volume: 0,
        autoCaptureFile: false,
        fileProgressTimer: null,
        fileDurationSec: wasFileMode ? audio.fileDurationSec : 0,
        fileStartedAt: 0,
        fileElapsedSec: fileCompleted ? audio.fileDurationSec : audio.fileElapsedSec,
        fileProgress: fileCompleted ? 1 : audio.fileProgress,
        filePhase: wasFileMode ? (fileCompleted ? "complete" : "stopped") : "idle",
        fileCompleted,
    };
    renderAudioMetrics();
    renderAudioInputMode();

    if (shouldSaveFileCapture) {
        try {
            await updateSetting("recordIO", 0, true);
            await saveLatestRecording({
                sourceType: "file",
                sourceName: fileCaptureName,
                toastMessage: "文件转换结果已保存到历史记录",
            });
        } catch (error) {
            showToast(`文件转换结果保存失败：${error.message}`);
        }
    } else if (fileCompleted) {
        showToast("文件转换完成");
    }
};

const startAudio = async () => {
    if (state.audio.running) {
        return;
    }
    const inputMode = getAudioInputMode();
    const file = inputMode === "file" ? selectedInputFile() : null;
    if (inputMode === "mic" && !navigator.mediaDevices?.getUserMedia) {
        showToast("浏览器不支持麦克风采集");
        return;
    }
    if (inputMode === "file" && !file) {
        showToast("请先选择输入音频文件");
        return;
    }
    if (!window.AudioWorkletNode) {
        showToast("浏览器不支持 AudioWorklet");
        return;
    }
    if (!window.LocalSocketIOClient) {
        showToast("低延迟 Socket.IO 客户端未加载");
        return;
    }

    $("startAudioButton").disabled = true;
    const modelReady = await ensureModelLoaded(defaultModelSlotToLoad(), false);
    if (!modelReady) {
        $("startAudioButton").disabled = false;
        return;
    }

    setAudioStatus("正在连接 Socket.IO");
    if (inputMode === "file") {
        resetFileProgress("decoding");
    }

    let startupSocket = null;
    let enabledAutoCapture = false;
    try {
        enabledAutoCapture = inputMode === "file" && shouldAutoSaveFileResult() && Number(state.info?.recordIO || 0) !== 1;
        if (enabledAutoCapture) {
            await updateSetting("recordIO", 1, true);
        }

        startupSocket = new window.LocalSocketIOClient({ namespace: "/test" });
        const socket = startupSocket;
        socket.on("response", handleSocketResponse);
        socket.on("connect", () => {
            setAudioStatus("Socket.IO 已连接");
            renderAudioMetrics();
        });
        socket.on("disconnect", () => {
            if (state.audio.running) {
                setAudioStatus("Socket.IO 已断开");
            }
        });
        socket.on("error", (error) => {
            showToast(error.message || String(error));
        });
        await socket.connect();

        setAudioStatus(inputMode === "file" ? "正在解码音频文件" : "正在请求麦克风");
        const inputDeviceId = $("audioInputSelect").value;
        const outputDeviceId = $("audioOutputSelect").value;
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const context = new AudioContextClass({ sampleRate: TARGET_SAMPLE_RATE });
        await context.audioWorklet.addModule("./realtime-worklet.js");
        let stream = null;
        let source = null;
        let fileName = "";
        let fileDurationSec = 0;

        if (inputMode === "mic") {
            stream = await navigator.mediaDevices.getUserMedia({
                video: false,
                audio: {
                    deviceId: inputDeviceId ? { exact: inputDeviceId } : undefined,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    channelCount: 1,
                },
            });
            source = context.createMediaStreamSource(stream);
        } else {
            const arrayBuffer = await file.arrayBuffer();
            const decodedBuffer = await context.decodeAudioData(arrayBuffer);
            source = context.createBufferSource();
            source.buffer = decodedBuffer;
            fileName = file.name;
            fileDurationSec = decodedBuffer.duration || 0;
            state.audio.fileDurationSec = fileDurationSec;
            state.audio.fileElapsedSec = 0;
            state.audio.fileProgress = 0;
            state.audio.filePhase = "decoding";
            renderFileProgress();
            source.onended = () => {
                if (!state.audio.running || state.audio.source !== source) {
                    return;
                }
                clearFileProgressTimer();
                state.audio.fileElapsedSec = state.audio.fileDurationSec;
                state.audio.fileProgress = 1;
                state.audio.filePhase = "flushing";
                state.audio.fileCompleted = true;
                renderFileProgress();
                setAudioStatus("文件播放结束，等待输出");
                window.setTimeout(() => {
                    if (state.audio.running && state.audio.source === source) {
                        stopAudio().catch((error) => showToast(error.message));
                    }
                }, 1500);
            };
        }

        const workletNode = new AudioWorkletNode(context, "local-realtime-voice-processor", {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
        });
        const outputGain = context.createGain();
        const outputDestination = context.createMediaStreamDestination();
        const outputElement = new Audio();

        outputGain.gain.value = 1;
        workletNode.port.onmessage = handleWorkletMessage;
        source.connect(workletNode);
        workletNode.connect(outputGain);
        outputGain.connect(outputDestination);
        outputElement.autoplay = true;
        outputElement.srcObject = outputDestination.stream;
        if (outputDeviceId && outputElement.setSinkId) {
            await outputElement.setSinkId(outputDeviceId);
        }
        document.body.appendChild(outputElement);
        await outputElement.play();

        const selectedChunk = Number($("serverReadChunkSize").value || state.info?.serverReadChunkSize || 128);
        state.audio = {
            ...state.audio,
            running: true,
            inputMode,
            fileName,
            context,
            stream,
            source,
            socket,
            workletNode,
            outputGain,
            outputDestination,
            outputElement,
            pendingInput: new Float32Array(0),
            chunkSamples: BASE_CHUNK_SIZE * selectedChunk,
            maxInFlight: selectedChunk <= 128 ? 4 : 3,
            inFlight: 0,
            requestCount: 0,
            responseCount: 0,
            dropCount: 0,
            lastLatencyMs: null,
            outputBufferLevel: 0,
            volume: 0,
            autoCaptureFile: enabledAutoCapture,
            fileProgressTimer: null,
            fileDurationSec,
            fileStartedAt: inputMode === "file" ? context.currentTime : 0,
            fileElapsedSec: 0,
            fileProgress: 0,
            filePhase: inputMode === "file" ? "running" : "idle",
            fileCompleted: false,
        };

        workletNode.port.postMessage({ requestType: "start" });
        if (source.start) {
            if (inputMode === "file") {
                state.audio.fileStartedAt = context.currentTime;
                state.audio.filePhase = "running";
                renderFileProgress();
            }
            source.start();
        }
        if (inputMode === "file") {
            startFileProgressTimer();
        }

        $("stopAudioButton").disabled = false;
        setAudioStatus(inputMode === "file" ? `文件输入中：${fileName}` : "低延迟运行中");
        renderAudioMetrics();
        renderAudioInputMode();
        await refreshBrowserDevices();
    } catch (error) {
        startupSocket?.close();
        await stopAudio();
        if (enabledAutoCapture) {
            await updateSetting("recordIO", 0, true).catch(() => {});
        }
        if (inputMode === "file") {
            state.audio.filePhase = "error";
            renderFileProgress();
        }
        showToast(`启动失败：${error.message}`);
    }
};

const selectedModel = () => {
    const info = state.info;
    if (!info || !Array.isArray(info.modelSlots)) {
        return null;
    }
    const selected = info.modelSlots.find((slot) => String(slot.slotIndex) === String(info.modelSlotIndex));
    if (selected) {
        return selected;
    }
    if (typeof info.modelSlotIndex === "number" && info.modelSlots[info.modelSlotIndex]) {
        return info.modelSlots[info.modelSlotIndex];
    }
    return info.modelSlots.find((slot) => slot.modelFile) || null;
};

const installedSlots = () => {
    return (state.info?.modelSlots || []).filter((slot) => slot && slot.modelFile);
};

const emptySlots = () => {
    return (state.info?.modelSlots || []).filter((slot) => !slot.modelFile && typeof slot.slotIndex === "number");
};

const iconUrl = (slot) => {
    if (!slot || !slot.iconFile) {
        return "/assets/icons/human.png";
    }
    const modelDir = state.info?.voiceChangerParams?.model_dir || "model_dir";
    const file = String(slot.iconFile).split(/[\\/]/).pop();
    return `/${modelDir}/${slot.slotIndex}/${file}`;
};

const sampleIconUrl = (sample) => {
    return sample.icon || "/assets/icons/human.png";
};

const setRange = (id, value) => {
    const input = $(id);
    const label = $(`${id}Value`);
    if (!input || !label) {
        return;
    }
    input.value = value ?? input.min ?? 0;
    label.textContent = input.step && Number(input.step) < 0.001 ? Number(input.value).toFixed(5) : String(input.value);
};

const setSelect = (id, options, selectedValue, labeler = (x) => x) => {
    const select = $(id);
    select.innerHTML = "";
    options.forEach((option) => {
        const el = document.createElement("option");
        el.value = String(typeof option === "object" ? option.value : option);
        el.textContent = labeler(option);
        select.appendChild(el);
    });
    select.value = String(selectedValue);
};

const renderHeader = () => {
    const info = state.info;
    $("serverStatus").textContent = info?.status || "离线";
    const gpu = (info?.gpus || []).find((item) => item.id === info.gpu);
    $("gpuStatus").textContent = gpu ? gpu.name : info?.gpu === -1 ? "CPU" : "GPU";
    $("modelCount").textContent = `${installedSlots().length} 个模型`;
};

const renderCurrentModel = () => {
    const model = selectedModel();
    const loading = state.system.deferredModelLoading || state.info?.modelLoadState === "loading";
    const loadNote = model && state.info?.modelLoaded === false ? ` / ${loading ? "加载中" : "未加载"}` : "";
    $("currentModelName").textContent = model?.name || "未选择模型";
    $("currentModelMeta").textContent = model ? `${model.voiceChangerType || "-"} / ${model.modelType || "-"} / Slot ${model.slotIndex}${loadNote}` : "请先选择模型";
    $("currentModelIcon").src = iconUrl(model);
    $("currentModelIcon").alt = model?.name || "当前模型头像";

    setRange("tune", state.info?.tran ?? model?.defaultTune ?? 0);
    setRange("indexRatio", state.info?.indexRatio ?? model?.defaultIndexRatio ?? 0);
    setRange("protect", state.info?.protect ?? model?.defaultProtect ?? 0.5);
    setRange("silentThreshold", state.info?.silentThreshold ?? 0);
    $("passThrough").checked = Boolean(state.info?.passThrough);
};

const renderPerformance = () => {
    setSelect("f0Detector", detectors, state.info?.f0Detector || "rmvpe_onnx");
    setSelect(
        "serverReadChunkSize",
        chunks,
        state.info?.serverReadChunkSize || 128,
        (value) => `${value} (${((Number(value) * 128 * 1000) / 48000).toFixed(1)} ms)`,
    );
    setSelect("extraConvertSize", extras, state.info?.extraConvertSize || 8192);
    const gpuOptions = [...(state.info?.gpus || []).map((gpu) => ({ value: gpu.id, label: `${gpu.name} (${(gpu.memory / 1024 / 1024 / 1024).toFixed(0)}GB)` })), { value: -1, label: "CPU" }];
    setSelect("gpu", gpuOptions, state.info?.gpu ?? 0, (option) => option.label);
};

const applyPreset = async (preset) => {
    state.activePreset = preset.id;
    for (const [key, value] of Object.entries(preset.settings)) {
        await updateSetting(key, value, true);
    }
    showToast(`已应用：${preset.label}`);
    render();
};

const saveCurrentPreset = () => {
    const defaultName = `自定义 ${new Date().toLocaleTimeString("zh-CN", { hour12: false }).slice(0, 5)}`;
    const label = window.prompt("保存为预设名称", defaultName)?.trim();
    if (!label) {
        return;
    }
    const description = window.prompt("预设说明", "当前参数")?.trim() || "当前参数";
    const preset = {
        id: `custom-${Date.now()}`,
        label: label.slice(0, 24),
        description: description.slice(0, 40),
        settings: currentPresetSettings(),
        custom: true,
    };
    state.customPresets = [...state.customPresets, preset];
    state.activePreset = preset.id;
    persistCustomPresets();
    renderPresets();
    showToast(`已保存预设：${preset.label}`);
};

const deleteCustomPreset = (presetId) => {
    const preset = state.customPresets.find((item) => item.id === presetId);
    if (!preset || !window.confirm(`删除预设“${preset.label}”？`)) {
        return;
    }
    state.customPresets = state.customPresets.filter((item) => item.id !== presetId);
    if (state.activePreset === presetId) {
        state.activePreset = "custom";
    }
    persistCustomPresets();
    renderPresets();
    showToast("预设已删除");
};

const updateModelInfo = async (slot, key, val) => {
    const form = new FormData();
    form.append("newData", JSON.stringify({ slot, key, val }));
    const response = await fetch("/update_model_info", {
        method: "POST",
        body: form,
    });
    if (!response.ok) {
        throw new Error(await apiErrorMessage(response, `更新模型信息失败: ${response.status}`));
    }
    state.info = await response.json();
    render();
};

const renameModel = async (slot, input) => {
    const name = input.value.trim();
    if (!name) {
        showToast("模型名称不能为空");
        return;
    }
    await updateModelInfo(slot.slotIndex, "name", name);
    showToast("模型已重命名");
};

const uploadModelAvatar = async (slot, file) => {
    if (!file) {
        return;
    }
    if (!isAllowedExtension(file, ["png", "jpg", "jpeg", "gif", "webp"])) {
        showToast("头像只支持 png / jpg / jpeg / gif / webp");
        return;
    }
    const storedName = normalizeFilename({ name: `slot-${slot.slotIndex}-${Date.now()}-${file.name}` });
    await uploadFileChunked(file, storedName);

    const form = new FormData();
    form.append("params", JSON.stringify({ slot: slot.slotIndex, name: "iconFile", file: storedName }));
    const response = await fetch("/upload_model_assets", {
        method: "POST",
        body: form,
    });
    if (!response.ok) {
        throw new Error(await apiErrorMessage(response, `上传头像失败: ${response.status}`));
    }
    state.info = await response.json();
    render();
    showToast("头像已更新");
};

const deleteModel = async (slot) => {
    if (state.audio.running) {
        showToast("请先停止实时变声再删除模型");
        return;
    }
    if (!window.confirm(`删除模型“${slot.name || `Slot ${slot.slotIndex}`}”？该操作会删除槽位文件。`)) {
        return;
    }
    const response = await fetch(`/api/local/models/${encodeURIComponent(slot.slotIndex)}`, {
        method: "DELETE",
    });
    if (!response.ok) {
        throw new Error(await apiErrorMessage(response, `删除模型失败: ${response.status}`));
    }
    state.info = await response.json();
    render();
    showToast("模型已删除");
};

const quickTestModel = async (slot) => {
    if (state.audio.running) {
        await stopAudio();
    }
    state.modelTestingSlot = slot.slotIndex;
    try {
        await updateSetting("modelSlotIndex", slot.slotIndex, true);
        if (getAudioInputMode() === "file" && selectedInputFile()) {
            showToast("已切换模型，开始文件测试");
            await startAudio();
        } else {
            showToast("已切换模型，可点击开始用麦克风测试");
        }
    } finally {
        state.modelTestingSlot = null;
        renderModels();
    }
};

const renderPresets = () => {
    const grid = $("presetGrid");
    grid.innerHTML = "";
    const presetList = allPresets();
    $("activePreset").textContent = presetList.find((preset) => preset.id === state.activePreset)?.label || "自定义";
    presetList.forEach((preset) => {
        const card = document.createElement("div");
        card.className = "preset-card";
        const button = document.createElement("button");
        button.type = "button";
        button.className = preset.id === state.activePreset ? "preset-button active" : "preset-button";
        button.innerHTML = `<strong>${preset.label}</strong><span>${preset.description}</span>`;
        button.addEventListener("click", async () => {
            try {
                await applyPreset(preset);
            } catch (error) {
                showToast(error.message);
            }
        });
        card.appendChild(button);
        if (preset.custom) {
            const actions = document.createElement("div");
            actions.className = "preset-card-actions";
            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "danger-button";
            deleteButton.textContent = "删除";
            deleteButton.addEventListener("click", () => deleteCustomPreset(preset.id));
            actions.appendChild(deleteButton);
            card.appendChild(actions);
        }
        grid.appendChild(card);
    });
};

const renderModels = () => {
    const grid = $("modelGrid");
    grid.innerHTML = "";
    installedSlots().forEach((slot) => {
        const isSelected = String(slot.slotIndex) === String(state.info?.modelSlotIndex);
        const manageable = typeof slot.slotIndex === "number";
        const card = document.createElement("article");
        card.className = isSelected ? "model-card selected" : "model-card";
        card.innerHTML = `
            <div class="model-card-main">
                <img src="${iconUrl(slot)}" alt="${escapeHtml(clampText(slot.name, "模型"))}">
                <div class="model-card-fields">
                    <label>
                        <span>名称</span>
                        <input class="model-name-input" type="text" value="${escapeHtml(clampText(slot.name, "未命名模型"))}" ${manageable ? "" : "disabled"}>
                    </label>
                    <div class="model-card-meta">Slot ${escapeHtml(slot.slotIndex)} / ${escapeHtml(clampText(slot.modelType || slot.voiceChangerType))}</div>
                    <div class="model-card-meta">${escapeHtml(clampText(slot.modelFile))}</div>
                </div>
            </div>
        `;
        const actions = document.createElement("div");
        actions.className = "model-card-actions";

        const switchButton = document.createElement("button");
        switchButton.type = "button";
        switchButton.textContent = isSelected ? "当前模型" : "切换";
        switchButton.disabled = isSelected;
        switchButton.addEventListener("click", async () => {
            try {
                await updateSetting("modelSlotIndex", slot.slotIndex);
                showToast(`已切换：${slot.name || `Slot ${slot.slotIndex}`}`);
            } catch (error) {
                showToast(error.message);
            }
        });
        actions.appendChild(switchButton);

        const testButton = document.createElement("button");
        testButton.type = "button";
        testButton.textContent = state.modelTestingSlot === slot.slotIndex ? "测试中" : "快速测试";
        testButton.disabled = state.modelTestingSlot === slot.slotIndex;
        testButton.addEventListener("click", () => {
            quickTestModel(slot).catch((error) => showToast(error.message));
        });
        actions.appendChild(testButton);

        if (manageable) {
            const renameButton = document.createElement("button");
            renameButton.type = "button";
            renameButton.textContent = "重命名";
            renameButton.addEventListener("click", () => {
                renameModel(slot, card.querySelector(".model-name-input")).catch((error) => showToast(error.message));
            });
            actions.appendChild(renameButton);

            const avatarLabel = document.createElement("label");
            avatarLabel.className = "button secondary";
            avatarLabel.textContent = "换头像";
            const avatarInput = document.createElement("input");
            avatarInput.type = "file";
            avatarInput.accept = "image/png,image/jpeg,image/gif,image/webp";
            avatarInput.addEventListener("change", () => {
                uploadModelAvatar(slot, avatarInput.files?.[0]).catch((error) => showToast(error.message));
            });
            avatarLabel.appendChild(avatarInput);
            actions.appendChild(avatarLabel);

            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "danger-button";
            deleteButton.textContent = "删除";
            deleteButton.addEventListener("click", () => {
                deleteModel(slot).catch((error) => showToast(error.message));
            });
            actions.appendChild(deleteButton);
        }

        card.appendChild(actions);
        grid.appendChild(card);
    });
};

const renderSamples = () => {
    const target = $("sampleTargetSlot");
    const language = $("sampleLanguage");
    const panel = $("samplePanel");
    const action = panel?.querySelector(".summary-action");
    const samples = state.info?.sampleModels || [];

    if (action) {
        action.textContent = panel?.open ? "收起" : "展开";
    }

    const currentTargetValue = target.value;
    const currentLanguageValue = language.value || "All";

    target.innerHTML = "";
    const slots = emptySlots().slice(0, 60);
    if (slots.length === 0) {
        const option = document.createElement("option");
        option.value = "4";
        option.textContent = "Slot 4";
        target.appendChild(option);
    } else {
        slots.forEach((slot) => {
            const option = document.createElement("option");
            option.value = String(slot.slotIndex);
            option.textContent = `Slot ${slot.slotIndex}`;
            target.appendChild(option);
        });
    }
    if (currentTargetValue) {
        target.value = currentTargetValue;
    }

    const langs = ["All", ...Array.from(new Set(samples.map((sample) => sample.lang).filter(Boolean)))];
    language.innerHTML = "";
    langs.forEach((lang) => {
        const option = document.createElement("option");
        option.value = lang;
        option.textContent = lang;
        language.appendChild(option);
    });
    language.value = langs.includes(currentLanguageValue) ? currentLanguageValue : "All";

    const sampleGrid = $("sampleGrid");
    sampleGrid.innerHTML = "";
    samples
        .filter((sample) => language.value === "All" || sample.lang === language.value)
        .slice(0, 80)
        .forEach((sample) => {
            const card = document.createElement("article");
            card.className = "sample-card";
            card.innerHTML = `
                <div class="sample-card-main">
                    <img src="${sampleIconUrl(sample)}" alt="${clampText(sample.name, "样例模型")}">
                    <div>
                        <div class="sample-card-title">${clampText(sample.name, sample.id)}</div>
                        <div class="sample-card-meta">${sample.voiceChangerType} / ${(sample.tag || []).join(", ")}</div>
                        <div class="sample-card-meta">${sample.sampleRate || "-"} Hz</div>
                    </div>
                </div>
            `;
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = "下载到目标槽";
            button.addEventListener("click", async () => {
                try {
                    await loadSampleModel(sample, Number(target.value));
                } catch (error) {
                    showToast(error.message);
                }
            });
            card.appendChild(button);
            sampleGrid.appendChild(card);
        });
};

const renderUploadSlots = () => {
    const select = $("uploadSlot");
    const currentValue = select.value;
    select.innerHTML = "";

    const slots = emptySlots().slice(0, 100);
    if (slots.length === 0) {
        const option = document.createElement("option");
        option.value = "4";
        option.textContent = "Slot 4";
        select.appendChild(option);
    } else {
        slots.forEach((slot) => {
            const option = document.createElement("option");
            option.value = String(slot.slotIndex);
            option.textContent = `Slot ${slot.slotIndex}`;
            select.appendChild(option);
        });
    }

    if (currentValue && Array.from(select.options).some((option) => option.value === currentValue)) {
        select.value = currentValue;
    }
};

const modelOptionLabel = (slot) => {
    if (!slot) {
        return "不自动切换";
    }
    return `Slot ${slot.slotIndex} / ${slot.name || slot.modelFile || "未命名模型"}`;
};

const savedParamsText = (params) => {
    if (!params) {
        return "尚未保存默认参数";
    }
    return [
        `Tune ${params.tran ?? "-"}`,
        `F0 ${params.f0Detector || "-"}`,
        `块 ${params.serverReadChunkSize || "-"}`,
        `附加 ${params.extraConvertSize || "-"}`,
        `Index ${params.indexRatio ?? "-"}`,
        `Protect ${params.protect ?? "-"}`,
    ].join(" / ");
};

const renderSystemStatus = () => {
    const status = state.system.status;
    const backend = status?.backend || {};
    const memory = backend.memory || {};
    const related = backend.relatedPythonProcesses || [];
    const workingSet = related.length ? related.reduce((sum, item) => sum + Number(item.workingSetBytes || 0), 0) : memory.workingSetBytes;
    const privateBytes = related.length ? related.reduce((sum, item) => sum + Number(item.privateBytes || 0), 0) : memory.privateBytes;
    const device = status?.device || {};
    const selectedGpu = device.gpu;
    const model = selectedModel();
    const loading = state.system.deferredModelLoading || state.info?.modelLoadState === "loading";
    const modelState = model && state.info?.modelLoaded === false ? ` / ${loading ? "加载中" : "未加载"}` : "";
    const inputCount = state.devices.inputs.length || (state.info?.serverAudioInputDevices || []).length;
    const outputCount = state.devices.outputs.length || (state.info?.serverAudioOutputDevices || []).length;

    if ($("runtimeBackendState")) {
        $("runtimeBackendState").textContent = backend.isRunning ? "运行中" : "离线";
        $("runtimePort").textContent = backend.port ? `${backend.host || "127.0.0.1"}:${backend.port}` : "127.0.0.1:6006";
        $("runtimePid").textContent = backend.pid ? String(backend.pid) : "-";
        $("runtimeMemory").textContent = `${formatMaybeBytes(workingSet)} / 提交 ${formatMaybeBytes(privateBytes)}`;
        $("runtimeModel").textContent = model ? `${modelOptionLabel(model)}${modelState}` : "未加载";
        $("runtimeDevice").textContent = selectedGpu ? selectedGpu.name : device.mode || (state.info?.gpu === -1 ? "CPU" : "GPU");
        $("runtimeLatency").textContent = state.audio.lastLatencyMs === null ? (state.audio.running ? "等待数据" : "-") : `${state.audio.lastLatencyMs} ms`;
        $("runtimeAudioDevices").textContent = `输入 ${inputCount} / 输出 ${outputCount}`;
    }
};

const renderSettingsCenter = () => {
    if (!$("defaultInputDevice")) {
        return;
    }
    const settings = { ...defaultLocalSettings(), ...(state.localSettings || {}) };
    populateDeviceSelect("defaultInputDevice", state.devices.inputs, "不指定默认麦克风", settings.inputDeviceId);
    populateDeviceSelect("defaultOutputDevice", state.devices.outputs, "不指定默认输出", settings.outputDeviceId);

    const modelSelect = $("defaultModelSlot");
    const modelOptions = [{ value: "", label: "不自动切换" }, ...installedSlots().map((slot) => ({ value: slot.slotIndex, label: modelOptionLabel(slot) }))];
    setSelect("defaultModelSlot", modelOptions, settings.modelSlotIndex ?? "", (option) => option.label);
    if (!Array.from(modelSelect.options).some((option) => option.value === String(settings.modelSlotIndex))) {
        modelSelect.value = "";
    }

    $("defaultAutoSaveFileResult").checked = settings.autoSaveFileResult !== false;
    $("defaultSettingsSummary").textContent = savedParamsText(settings.params);
};

const renderStartupChecks = () => {
    const list = $("startupChecks");
    if (!list) {
        return;
    }
    const checks = state.system.checks?.checks || [];
    const summary = $("startupSummaryStatus");
    const panel = $("startupPanel");
    if (!checks.length) {
        if (summary) {
            summary.textContent = "正在检查本地环境";
        }
        panel?.classList.remove("all-ok", "has-warnings");
        list.innerHTML = `<div class="empty-state">正在检查本地环境</div>`;
        return;
    }
    const warnCount = checks.filter((check) => !check.ok).length;
    if (summary) {
        summary.textContent = warnCount ? `${warnCount} 项需要处理 / ${checks.length} 项检查` : `${checks.length} 项检查正常`;
    }
    panel?.classList.toggle("has-warnings", warnCount > 0);
    panel?.classList.toggle("all-ok", warnCount === 0);
    list.innerHTML = "";
    checks.forEach((check) => {
        const item = document.createElement("div");
        item.className = check.ok ? "check-item ok" : "check-item warn";
        item.innerHTML = `
            <span class="check-dot"></span>
            <div>
                <div class="check-title">
                    <span>${escapeHtml(check.label)}</span>
                    <span>${check.ok ? "正常" : "需处理"}</span>
                </div>
                <div class="check-detail">${escapeHtml(check.detail || "-")}</div>
            </div>
        `;
        list.appendChild(item);
    });
};

const renderUploadPanel = () => {
    const panel = $("uploadPanel");
    const action = $("uploadPanelAction");
    if (panel && action) {
        action.textContent = panel.open ? "收起" : "展开上传";
    }
};

const renderDiagnostics = () => {
    renderSystemStatus();
    renderSettingsCenter();
    renderStartupChecks();
};

const render = () => {
    if (!state.info) {
        return;
    }
    renderHeader();
    renderCurrentModel();
    renderPerformance();
    renderPresets();
    renderModels();
    renderSamples();
    renderUploadSlots();
    renderDiagnostics();
    renderAudioMetrics();
    renderAudioInputMode();
    renderRecording();
    renderRecordings();
};

const localSystemPost = async (path, fallback) => {
    const response = await fetch(`/api/local/system/${path}`, { method: "POST" });
    if (!response.ok) {
        throw new Error(await apiErrorMessage(response, `${fallback}: ${response.status}`));
    }
    const contentType = response.headers.get("content-type") || "";
    return contentType.includes("application/json") ? response.json() : {};
};

const stopRealtimeAndRelease = async (message = "实时变声已停止") => {
    if (state.audio.running) {
        await stopAudio();
    }
    await localSystemPost("release-audio", "释放实时链路失败");
    await fetchInfo();
    await fetchSystemStatus(true);
    showToast(message);
};

const releaseCurrentModel = async () => {
    if (!window.confirm("卸载当前模型？模型文件不会删除，但需要重新选择模型才能继续变声。")) {
        return;
    }
    if (state.audio.running) {
        await stopAudio();
    }
    state.info = await localSystemPost("release-model", "卸载模型失败");
    render();
    await fetchSystemStatus(true);
    showToast("当前模型已卸载");
};

const controlBackend = async (action) => {
    const label = action === "restart" ? "重启" : "停止";
    if (!window.confirm(`${label}本地后端？${action === "stop" ? " 页面会暂时离线。" : " 服务会自动重新启动。"}`)) {
        return;
    }
    await localSystemPost(action, `${label}后端失败`);
    $("serverStatus").textContent = action === "restart" ? "重启中" : "停止中";
    showToast(action === "restart" ? "正在重启后端" : "正在停止后端");
    if (action === "restart") {
        state.system.initialized = false;
        startInitRetry();
    }
};

const applyLocalDefaults = async (silent = false, options = {}) => {
    const settings = { ...defaultLocalSettings(), ...(state.localSettings || {}) };
    const shouldLoadModel = options.loadModel !== false;
    state.system.applyingDefaults = true;
    try {
        if (settings.inputDeviceId && Array.from($("audioInputSelect").options).some((option) => option.value === settings.inputDeviceId)) {
            $("audioInputSelect").value = settings.inputDeviceId;
        }
        if (settings.outputDeviceId && Array.from($("audioOutputSelect").options).some((option) => option.value === settings.outputDeviceId)) {
            $("audioOutputSelect").value = settings.outputDeviceId;
            await setElementSink(state.audio.outputElement, settings.outputDeviceId);
            await setElementSink($("recordInputAudio"), settings.outputDeviceId);
            await setElementSink($("recordOutputAudio"), settings.outputDeviceId);
            await setHistoryAudioSinks();
        }
        $("autoSaveFileResult").checked = settings.autoSaveFileResult !== false;

        const defaultSlot = settings.modelSlotIndex === "" ? null : Number(settings.modelSlotIndex);
        if (shouldLoadModel && Number.isInteger(defaultSlot) && defaultSlot >= 0 && String(state.info?.modelSlotIndex) !== String(defaultSlot)) {
            await updateSetting("modelSlotIndex", defaultSlot, true);
        }

        const params = settings.params || {};
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null && String(state.info?.[key]) !== String(value)) {
                await updateSetting(key, value, true);
            }
        }
        if (!silent) {
            showToast("已应用启动默认");
        }
    } finally {
        state.system.applyingDefaults = false;
        render();
    }
};

const clearLocalDefaults = () => {
    if (!window.confirm("清空启动默认设置？")) {
        return;
    }
    state.localSettings = defaultLocalSettings();
    persistLocalSettings();
    renderSettingsCenter();
    showToast("启动默认已清空");
};

const bind = () => {
    $("themeSelect")?.addEventListener("change", (event) => {
        applyTheme(event.target.value);
        persistTheme(state.theme);
        showToast(state.theme === "anime" ? "已切换到 Anime Pop" : "已切换到 Clean Light");
    });
    $("refreshButton").addEventListener("click", () => {
        Promise.all([fetchInfo(), refreshSystem(true)]).then(() => showToast("已刷新")).catch((error) => showToast(error.message));
    });
    $("stopBackendButton").addEventListener("click", () => {
        controlBackend("stop").catch((error) => showToast(error.message));
    });
    $("restartBackendButton").addEventListener("click", () => {
        controlBackend("restart").catch((error) => showToast(error.message));
    });
    $("releaseAudioButton").addEventListener("click", () => {
        stopRealtimeAndRelease("实时链路已释放").catch((error) => showToast(error.message));
    });
    $("releaseModelButton").addEventListener("click", () => {
        releaseCurrentModel().catch((error) => showToast(error.message));
    });
    $("saveDefaultsButton").addEventListener("click", captureCurrentDefaults);
    $("applyDefaultsButton").addEventListener("click", () => {
        applyLocalDefaults(false).catch((error) => showToast(error.message));
    });
    $("clearDefaultsButton").addEventListener("click", clearLocalDefaults);
    $("defaultInputDevice").addEventListener("change", (event) => {
        updateLocalSettings({ inputDeviceId: event.target.value });
        showToast("默认麦克风已保存");
    });
    $("defaultOutputDevice").addEventListener("change", (event) => {
        updateLocalSettings({ outputDeviceId: event.target.value });
        showToast("默认输出已保存");
    });
    $("defaultModelSlot").addEventListener("change", (event) => {
        updateLocalSettings({ modelSlotIndex: event.target.value });
        showToast("默认模型已保存");
    });
    $("defaultAutoSaveFileResult").addEventListener("change", (event) => {
        updateLocalSettings({ autoSaveFileResult: event.target.checked });
        $("autoSaveFileResult").checked = event.target.checked;
        showToast("文件保存默认值已保存");
    });
    $("savePresetButton").addEventListener("click", saveCurrentPreset);

    $("startAudioButton").addEventListener("click", () => {
        startAudio();
    });
    $("stopAudioButton").addEventListener("click", () => {
        stopAudio();
    });
    $("reloadDevicesButton").addEventListener("click", async () => {
        await refreshBrowserDevices();
        showToast("设备列表已刷新");
    });
    document.querySelectorAll('input[name="audioInputMode"]').forEach((input) => {
        input.addEventListener("change", renderAudioInputMode);
    });
    $("audioInputFile").addEventListener("change", () => {
        resetFileProgress("idle");
        renderAudioInputMode();
    });
    $("audioOutputSelect").addEventListener("change", async (event) => {
        const output = state.audio.outputElement;
        try {
            if (output?.setSinkId) {
                await output.setSinkId(event.target.value);
            }
            await setElementSink($("recordInputAudio"), event.target.value);
            await setElementSink($("recordOutputAudio"), event.target.value);
            await setHistoryAudioSinks();
            showToast("输出设备已切换");
        } catch (error) {
            showToast(`输出设备切换失败：${error.message}`);
        }
    });
    $("startRecordButton").addEventListener("click", () => {
        startRecording().catch((error) => showToast(error.message));
    });
    $("stopRecordButton").addEventListener("click", () => {
        stopRecording().catch((error) => showToast(error.message));
    });
    $("refreshRecordingsButton").addEventListener("click", () => {
        loadRecordings().then(() => showToast("历史记录已刷新")).catch((error) => showToast(error.message));
    });
    $("uploadForm").addEventListener("submit", (event) => {
        event.preventDefault();
        uploadRVCModel();
    });
    $("uploadPanel")?.addEventListener("toggle", renderUploadPanel);
    renderUploadPanel();

    $("tune").addEventListener("input", (event) => {
        $("tuneValue").textContent = event.target.value;
    });
    $("tune").addEventListener("change", (event) => updateSetting("tran", event.target.value).catch((error) => showToast(error.message)));

    $("indexRatio").addEventListener("input", (event) => {
        $("indexRatioValue").textContent = event.target.value;
    });
    $("indexRatio").addEventListener("change", (event) => updateSetting("indexRatio", event.target.value).catch((error) => showToast(error.message)));

    $("protect").addEventListener("input", (event) => {
        $("protectValue").textContent = event.target.value;
    });
    $("protect").addEventListener("change", (event) => updateSetting("protect", event.target.value).catch((error) => showToast(error.message)));

    $("silentThreshold").addEventListener("input", (event) => {
        $("silentThresholdValue").textContent = Number(event.target.value).toFixed(5);
    });
    $("silentThreshold").addEventListener("change", (event) => updateSetting("silentThreshold", event.target.value).catch((error) => showToast(error.message)));

    $("passThrough").addEventListener("change", (event) => updateSetting("passThrough", event.target.checked ? "true" : "false").catch((error) => showToast(error.message)));
    $("f0Detector").addEventListener("change", (event) => updateSetting("f0Detector", event.target.value).catch((error) => showToast(error.message)));
    $("serverReadChunkSize").addEventListener("change", (event) => updateSetting("serverReadChunkSize", event.target.value).catch((error) => showToast(error.message)));
    $("extraConvertSize").addEventListener("change", (event) => updateSetting("extraConvertSize", event.target.value).catch((error) => showToast(error.message)));
    $("gpu").addEventListener("change", (event) => updateSetting("gpu", event.target.value).catch((error) => showToast(error.message)));
    $("sampleLanguage").addEventListener("change", renderSamples);
    $("samplePanel").addEventListener("toggle", renderSamples);
};

state.customPresets = loadCustomPresets();
state.localSettings = loadLocalSettings();
applyTheme(loadTheme());
bind();

const initialize = async (isRetry = false) => {
    if (state.system.initializing || state.system.initialized) {
        return;
    }
    state.system.initializing = true;
    if (!isRetry) {
        $("serverStatus").textContent = "连接中";
    }
    try {
        await refreshBrowserDevices();
        await fetchInfo();
        await applyLocalDefaults(true, { loadModel: false });
        await loadRecordings(true);
        await refreshSystem(true);
        startSystemPolling();
        state.system.initialized = true;
        state.system.initAttempts = 0;
        stopInitRetry();
        window.setTimeout(loadDeferredModelAfterStartup, 100);
    } catch (error) {
        state.system.initAttempts += 1;
        $("serverStatus").textContent = "离线";
        const shouldNotify = !isRetry || state.system.initAttempts === 1 || state.system.initAttempts % 5 === 0;
        if (shouldNotify) {
            showToast(`后端连接失败，自动重试中：${error.message}`);
        }
        startInitRetry();
    } finally {
        state.system.initializing = false;
    }
};

initialize();
