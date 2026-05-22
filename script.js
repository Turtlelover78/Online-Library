const STORAGE_KEY = "your-library-books";
const APP_STATE_KEY = "your-library-app-state";
const MAX_SCAN_DIMENSION = 1800;
const SHARED_LIBRARY_ROOT = "your-library-shared";
const GUN_PEERS = ["https://gun-manhattan.herokuapp.com/gun"];
const savedAppState = loadAppState();
const initialLibraries = normalizeSavedLibraries(savedAppState.libraries);

const state = {
  detector: null,
  library: loadLibrary(),
  lookupInProgress: false,
  lastIsbn: "",
  lastIsbnAt: 0,
  stream: null,
  cameraActive: false,
  autoScanTimerId: null,
  liveDetectionInProgress: false,
  liveDetectedValue: "",
  liveDetectedCount: 0,
  liveLastSeenAt: 0,
  activeLibraryType: savedAppState.activeLibraryType === "shared" ? "shared" : "private",
  activeSharedCode: savedAppState.activeSharedCode || "",
  libraries: initialLibraries,
  activeLibraryId:
    savedAppState.activeLibraryId && initialLibraries.some((library) => library.id === savedAppState.activeLibraryId)
      ? savedAppState.activeLibraryId
      : "private-local",
  activePage: savedAppState.activePage === "library" ? "library" : "scanner",
  titleQuery: "",
  authorQuery: "",
  gun: null,
  sharedBooksMap: new Map(),
  sharedSessionId: 0,
};

const elements = {
  video: document.getElementById("scannerVideo"),
  preview: document.getElementById("scannerPreview"),
  placeholder: document.getElementById("scannerPlaceholder"),
  status: document.getElementById("statusMessage"),
  scannerPage: document.getElementById("scannerPage"),
  libraryPage: document.getElementById("libraryPage"),
  startBtn: document.getElementById("startScannerBtn"),
  cancelBtn: document.getElementById("cancelCameraBtn"),
  imageInput: document.getElementById("barcodeImageInput"),
  manualForm: document.getElementById("manualIsbnForm"),
  manualInput: document.getElementById("manualIsbnInput"),
  libraryGrid: document.getElementById("libraryGrid"),
  bookCount: document.getElementById("bookCount"),
  clearLibraryBtn: document.getElementById("clearLibraryBtn"),
  libraryModeLabel: document.getElementById("libraryModeLabel"),
  privateLibraryBtn: document.getElementById("privateLibraryBtn"),
  createSharedLibraryBtn: document.getElementById("createSharedLibraryBtn"),
  leaveSharedLibraryBtn: document.getElementById("leaveSharedLibraryBtn"),
  inviteCodeInput: document.getElementById("inviteCodeInput"),
  joinSharedLibraryBtn: document.getElementById("joinSharedLibraryBtn"),
  sharedCodeSection: document.getElementById("sharedCodeSection"),
  sharedCodeDisplay: document.getElementById("sharedCodeDisplay"),
  copyInviteCodeBtn: document.getElementById("copyInviteCodeBtn"),
  titleSearchInput: document.getElementById("titleSearchInput"),
  authorSearchInput: document.getElementById("authorSearchInput"),
  scannerNavBtn: document.getElementById("scannerNavBtn"),
  librarySwitcherList: document.getElementById("librarySwitcherList"),
  scannerTargetLabel: document.getElementById("scannerTargetLabel"),
  openCreateSharedModalBtn: document.getElementById("openCreateSharedModalBtn"),
  libraryNameModal: document.getElementById("libraryNameModal"),
  libraryNameForm: document.getElementById("libraryNameForm"),
  libraryNameInput: document.getElementById("libraryNameInput"),
  cancelLibraryNameBtn: document.getElementById("cancelLibraryNameBtn"),
};

initialize();

async function initialize() {
  elements.libraryNameModal.hidden = true;
  initializeSharedDatabase();
  syncDerivedLibraryState();
  renderLibrarySwitcher();
  updateLibraryModeUi();
  updatePageUi();
  syncSearchInputs();
  wireEvents();
  await setupDetector();
  if (state.activeLibraryType === "shared" && state.activeSharedCode && getCurrentLibraryEntry()) {
    connectToSharedLibrary(getCurrentLibraryEntry(), { restoring: true });
  } else {
    renderLibrary();
  }
}

function wireEvents() {
  elements.startBtn.addEventListener("click", startScanner);
  elements.cancelBtn.addEventListener("click", cancelCamera);
  elements.imageInput.addEventListener("change", onImageSelected);
  elements.manualForm.addEventListener("submit", onManualSubmit);
  elements.clearLibraryBtn.addEventListener("click", clearLibrary);
  elements.libraryGrid.addEventListener("click", onLibraryAction);
  elements.libraryGrid.addEventListener("error", onLibraryImageError, true);
  elements.privateLibraryBtn.addEventListener("click", switchToPrivateLibrary);
  elements.createSharedLibraryBtn.addEventListener("click", openCreateSharedLibraryModal);
  elements.leaveSharedLibraryBtn.addEventListener("click", leaveCurrentSharedLibrary);
  elements.joinSharedLibraryBtn.addEventListener("click", onJoinSharedLibrary);
  elements.copyInviteCodeBtn.addEventListener("click", copyInviteCode);
  elements.titleSearchInput.addEventListener("input", onSearchChanged);
  elements.authorSearchInput.addEventListener("input", onSearchChanged);
  elements.scannerNavBtn.addEventListener("click", () => setActivePage("scanner"));
  elements.librarySwitcherList.addEventListener("click", onLibrarySwitcherClick);
  elements.openCreateSharedModalBtn.addEventListener("click", openCreateSharedLibraryModal);
  elements.libraryNameForm.addEventListener("submit", onCreateSharedLibrarySubmit);
  elements.cancelLibraryNameBtn.addEventListener("click", closeCreateSharedLibraryModal);
  elements.libraryNameModal.addEventListener("click", onLibraryModalBackdropClick);
  window.addEventListener("beforeunload", stopCamera);
}

async function setupDetector() {
  if ("BarcodeDetector" in window) {
    try {
      const preferredFormats = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"];
      const supportedFormats = BarcodeDetector.getSupportedFormats
        ? await BarcodeDetector.getSupportedFormats()
        : preferredFormats;
      const formats = preferredFormats.filter((format) => supportedFormats.includes(format));

      state.detector = new BarcodeDetector({
        formats: formats.length ? formats : preferredFormats,
      });
    } catch (error) {
      console.error(error);
      state.detector = null;
    }
  }

  if (canScanBooks()) {
    setStatus(
      "Scanner ready. Open the camera, line the barcode up with the center bar, and the app will scan it automatically.",
      "info"
    );
    return;
  }

  setStatus(
    "Barcode scanning is not supported in this browser. You can still type an ISBN manually.",
    "warning"
  );
  elements.startBtn.disabled = true;
  elements.imageInput.disabled = true;
}

function initializeSharedDatabase() {
  if (typeof window.Gun !== "function") {
    return;
  }

  state.gun = window.Gun({
    peers: GUN_PEERS,
    file: "your-library-browser-data",
  });
}

function normalizeSavedLibraries(savedLibraries) {
  const libraries = Array.isArray(savedLibraries) ? savedLibraries : [];
  const seen = new Set();
  const normalized = libraries
    .map((library) => normalizeLibraryEntry(library))
    .filter((library) => {
      if (!library || seen.has(library.id)) {
        return false;
      }

      seen.add(library.id);
      return true;
    });

  if (!normalized.some((library) => library.id === "private-local")) {
    normalized.unshift({
      id: "private-local",
      type: "private",
      name: "Private Library",
    });
  }

  return normalized;
}

function normalizeLibraryEntry(library) {
  if (!library || typeof library !== "object") {
    return null;
  }

  if (library.type === "private") {
    return {
      id: "private-local",
      type: "private",
      name: library.name || "Private Library",
    };
  }

  if (library.type === "shared" && library.code) {
    const normalizedCode = normalizeInviteCode(library.code);
    if (!normalizedCode) {
      return null;
    }

    return {
      id: `shared-${normalizedCode}`,
      type: "shared",
      code: normalizedCode,
      name: library.name || `Shared Library ${formatInviteCode(normalizedCode)}`,
    };
  }

  return null;
}

function getCurrentLibraryEntry() {
  return state.libraries.find((library) => library.id === state.activeLibraryId) || state.libraries[0] || null;
}

function syncDerivedLibraryState() {
  const currentLibrary = getCurrentLibraryEntry();
  if (!currentLibrary) {
    return;
  }

  state.activeLibraryId = currentLibrary.id;
  state.activeLibraryType = currentLibrary.type;
  state.activeSharedCode = currentLibrary.type === "shared" ? currentLibrary.code : "";
}

function syncSearchInputs() {
  elements.titleSearchInput.value = state.titleQuery;
  elements.authorSearchInput.value = state.authorQuery;
}

function updateLibraryModeUi() {
  const currentLibrary = getCurrentLibraryEntry();
  const inSharedMode = currentLibrary?.type === "shared" && Boolean(currentLibrary.code);
  elements.leaveSharedLibraryBtn.hidden = !inSharedMode;
  elements.sharedCodeSection.hidden = !inSharedMode;
  elements.privateLibraryBtn.disabled = !inSharedMode;
  elements.sharedCodeDisplay.value = inSharedMode ? formatInviteCode(currentLibrary.code) : "";
  elements.libraryModeLabel.textContent = inSharedMode
    ? `${currentLibrary.name} • code ${formatInviteCode(currentLibrary.code)}`
    : `${currentLibrary?.name || "Private Library"} on this device`;
  elements.scannerTargetLabel.textContent = `Scanning into ${currentLibrary?.name || "Private Library"}`;
}

function updatePageUi() {
  const onScannerPage = state.activePage === "scanner";
  elements.scannerPage.hidden = !onScannerPage;
  elements.libraryPage.hidden = onScannerPage;
  elements.scannerNavBtn.classList.toggle("is-active", onScannerPage);
  renderLibrarySwitcher();
}

function renderLibrarySwitcher() {
  const currentId = state.activeLibraryId;
  const currentPage = state.activePage;

  elements.librarySwitcherList.innerHTML = state.libraries
    .map((library) => {
      const isActive = currentPage === "library" && library.id === currentId;
      const meta =
        library.type === "shared"
          ? `${library.name} • ${formatInviteCode(library.code)}`
          : `${library.name} • local`;

      return `
        <button class="library-switcher-item${isActive ? " is-active" : ""}" type="button" data-library-id="${escapeHtml(
          library.id
        )}">
          <span class="library-switcher-name">${escapeHtml(library.name)}</span>
          <span class="library-switcher-meta">${escapeHtml(meta)}</span>
        </button>
      `;
    })
    .join("");
}

async function startScanner() {
  clearPreview();

  if (canUseLiveCamera()) {
    await startLiveCamera();
    return;
  }

  if (canScanBooks()) {
    setStatus(
      "Your browser does not support the live camera preview here, so the photo chooser is opening instead.",
      "info"
    );
    openPhotoPicker();
    return;
  }

  setStatus("Camera scanning is unavailable here. Try manual ISBN entry instead.", "warning");
}

async function startLiveCamera() {
  try {
    stopCamera();
    setStatus("Requesting camera access. Then line the barcode up with the center bar and hold still for automatic scanning.", "info");

    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });

    elements.video.srcObject = state.stream;
    await elements.video.play();

    state.cameraActive = true;
    elements.video.hidden = false;
    elements.preview.hidden = true;
    elements.placeholder.hidden = true;
    elements.startBtn.hidden = true;
    elements.cancelBtn.hidden = false;
    resetLiveDetectionState();
    setStatus("Center the barcode on the glowing line. As soon as it looks readable, the app will capture it automatically.", "info");
    scheduleNextLiveDetection();
  } catch (error) {
    console.error(error);

    if (canScanBooks()) {
      setStatus("Live camera preview was unavailable, so the photo chooser is opening instead.", "warning");
      openPhotoPicker();
      return;
    }

    setStatus("Camera access was blocked. You can still enter an ISBN manually.", "error");
  }
}

function openPhotoPicker() {
  try {
    if (typeof elements.imageInput.showPicker === "function") {
      elements.imageInput.showPicker();
      return;
    }

    elements.imageInput.click();
  } catch (error) {
    console.error(error);
    setStatus("Your browser blocked the photo chooser. Tap the photo field below instead.", "error");
  }
}

function cancelCamera() {
  stopCamera();
  clearPreview();
  setStatus("Camera cancelled. You can reopen it whenever you want to scan another book.", "info");
}

function stopCamera() {
  if (state.autoScanTimerId) {
    window.clearTimeout(state.autoScanTimerId);
    state.autoScanTimerId = null;
  }

  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }

  state.cameraActive = false;
  state.liveDetectionInProgress = false;
  elements.video.pause();
  elements.video.srcObject = null;
  elements.video.hidden = true;
  elements.startBtn.hidden = false;
  elements.cancelBtn.hidden = true;
  resetLiveDetectionState();

  if (elements.preview.hidden) {
    elements.placeholder.hidden = false;
  }
}

function onSearchChanged() {
  state.titleQuery = elements.titleSearchInput.value.trim().toLowerCase();
  state.authorQuery = elements.authorSearchInput.value.trim().toLowerCase();
  renderLibrary();
}

function onJoinSharedLibrary() {
  const normalizedCode = normalizeInviteCode(elements.inviteCodeInput.value);
  if (!normalizedCode) {
    setStatus("Enter a valid invite code first.", "warning");
    return;
  }

  const existingLibrary = state.libraries.find((library) => library.type === "shared" && library.code === normalizedCode);
  if (existingLibrary) {
    activateLibrary(existingLibrary.id, { switchPage: true, restoring: false });
    setStatus(`Opened ${existingLibrary.name}.`, "success");
    return;
  }

  const libraryEntry = {
    id: `shared-${normalizedCode}`,
    type: "shared",
    code: normalizedCode,
    name: `Shared Library ${formatInviteCode(normalizedCode)}`,
  };

  state.libraries.push(libraryEntry);
  activateLibrary(libraryEntry.id, { switchPage: true, restoring: false, joined: true });
}

function switchToPrivateLibrary() {
  activateLibrary("private-local", { switchPage: true });
  setStatus("Switched back to your private library on this device.", "info");
}

function leaveCurrentSharedLibrary() {
  const currentLibrary = getCurrentLibraryEntry();
  if (!currentLibrary || currentLibrary.type !== "shared") {
    return;
  }

  state.libraries = state.libraries.filter((library) => library.id !== currentLibrary.id);
  state.sharedBooksMap = new Map();
  state.sharedSessionId += 1;
  activateLibrary("private-local", { switchPage: true, silentStatus: true });
  setStatus(`Removed ${currentLibrary.name} from your sidebar.`, "info");
}

function openCreateSharedLibraryModal() {
  if (!state.gun) {
    setStatus("Shared libraries are unavailable right now because the sync service did not load.", "error");
    return;
  }

  elements.libraryNameInput.value = "";
  elements.libraryNameModal.hidden = false;
  window.setTimeout(() => {
    elements.libraryNameInput.focus();
  }, 0);
}

function closeCreateSharedLibraryModal() {
  elements.libraryNameModal.hidden = true;
}

function onLibraryModalBackdropClick(event) {
  if (event.target === elements.libraryNameModal) {
    closeCreateSharedLibraryModal();
  }
}

function onCreateSharedLibrarySubmit(event) {
  event.preventDefault();
  const libraryName = elements.libraryNameInput.value.trim();
  if (!libraryName) {
    elements.libraryNameInput.focus();
    setStatus("Shared libraries need a name before they can be created.", "warning");
    return;
  }

  createSharedLibrary(libraryName);
  closeCreateSharedLibraryModal();
}

function createSharedLibrary(libraryName) {
  const normalizedName = libraryName.trim();
  if (!normalizedName) {
    setStatus("Shared libraries need a name before they can be created.", "warning");
    return;
  }

  const code = generateInviteCode();
  const libraryEntry = {
    id: `shared-${code}`,
    type: "shared",
    code,
    name: normalizedName,
  };

  state.libraries.push(libraryEntry);
  activateLibrary(libraryEntry.id, { switchPage: true, created: true });
}

function activateLibrary(libraryId, options = {}) {
  const libraryEntry = state.libraries.find((library) => library.id === libraryId);
  if (!libraryEntry) {
    return;
  }

  state.activeLibraryId = libraryEntry.id;
  state.activeLibraryType = libraryEntry.type;
  state.activeSharedCode = libraryEntry.type === "shared" ? libraryEntry.code : "";
  if (options.switchPage !== false) {
    state.activePage = "library";
  }

  if (libraryEntry.type === "shared") {
    connectToSharedLibrary(libraryEntry, options);
  } else {
    state.sharedBooksMap = new Map();
    state.sharedSessionId += 1;
    persistAppState();
    updateLibraryModeUi();
    updatePageUi();
    renderLibrary();
  }
}

function setActivePage(page) {
  state.activePage = page === "library" ? "library" : "scanner";
  persistAppState();
  updatePageUi();
}

function connectToSharedLibrary(libraryEntry, options = {}) {
  if (!state.gun) {
    setStatus("Shared libraries are unavailable right now because the sync service did not load.", "error");
    return;
  }

  const sessionId = state.sharedSessionId + 1;
  state.sharedSessionId = sessionId;
  state.sharedBooksMap = new Map();
  elements.inviteCodeInput.value = formatInviteCode(libraryEntry.code);
  persistAppState();
  updateLibraryModeUi();
  updatePageUi();
  renderLibrary();

  const sharedRootRef = state.gun.get(SHARED_LIBRARY_ROOT).get(libraryEntry.code);
  const sharedBooksRef = sharedRootRef.get("books");
  const sharedMetaRef = sharedRootRef.get("meta");

  if (options.created) {
    sharedMetaRef.put({
      code: libraryEntry.code,
      name: libraryEntry.name,
      updatedAt: new Date().toISOString(),
    });
  }

  sharedMetaRef.on((meta) => {
    if (sessionId !== state.sharedSessionId || libraryEntry.id !== state.activeLibraryId) {
      return;
    }

    if (meta?.name) {
      const matchingLibrary = state.libraries.find((library) => library.id === libraryEntry.id);
      if (matchingLibrary) {
        matchingLibrary.name = meta.name;
        persistAppState();
        updateLibraryModeUi();
        updatePageUi();
      }
    }
  });

  sharedBooksRef.map().on((data, key) => {
    if (sessionId !== state.sharedSessionId || state.activeSharedCode !== libraryEntry.code) {
      return;
    }

    if (!data || data === null || !data.title) {
      state.sharedBooksMap.delete(key);
    } else {
      state.sharedBooksMap.set(key, normalizeSharedBook(data, key));
    }

    renderLibrary();
  });

  setStatus(
    options.created
      ? `Shared library "${libraryEntry.name}" created. Invite people with code ${formatInviteCode(libraryEntry.code)}.`
      : options.restoring
        ? `Reconnected to ${libraryEntry.name}.`
        : options.joined
          ? `Joined ${libraryEntry.name}.`
          : `Opened ${libraryEntry.name}.`,
    "success"
  );
}

async function copyInviteCode() {
  if (!state.activeSharedCode) {
    setStatus("Create or join a shared library first.", "warning");
    return;
  }

  const displayCode = formatInviteCode(state.activeSharedCode);

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(displayCode);
      setStatus("Invite code copied.", "success");
      return;
    }
  } catch (error) {
    console.error(error);
  }

  elements.sharedCodeDisplay.select();
  document.execCommand("copy");
  setStatus("Invite code copied.", "success");
}

async function onImageSelected(event) {
  const file = event.target.files?.[0];
  if (!file) {
    setStatus("Photo selection cancelled. Tap Scan Barcode when you want to try again.", "info");
    return;
  }

  if (!canScanBooks()) {
    setStatus("Photo barcode reading is not supported here. Please type the ISBN manually.", "warning");
    event.target.value = "";
    return;
  }

  stopCamera();

  try {
    setStatus("Scanning the barcode photo...", "info");
    const imageCanvas = await loadFileIntoCanvas(file);
    showCanvasPreview(imageCanvas);
    const rawValue = await detectBarcodeFromCanvas(imageCanvas);

    if (!rawValue) {
      setStatus(
        "I could not find the barcode in that photo. Try filling more of the frame with the barcode and keeping it on the center guide line.",
        "error"
      );
      return;
    }

    await handleDetectedBarcode(rawValue);
  } catch (error) {
    console.error(error);
    setStatus("That image could not be scanned. Try another photo or type the ISBN manually.", "error");
  } finally {
    event.target.value = "";
  }
}

function scheduleNextLiveDetection() {
  if (!state.cameraActive) {
    return;
  }

  state.autoScanTimerId = window.setTimeout(runLiveDetection, 80);
}

async function runLiveDetection() {
  if (!state.cameraActive) {
    return;
  }

  if (state.liveDetectionInProgress || state.lookupInProgress) {
    scheduleNextLiveDetection();
    return;
  }

  if (elements.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    scheduleNextLiveDetection();
    return;
  }

  state.liveDetectionInProgress = true;

  try {
    const liveResult = await detectLiveBarcode();
    const rawValue = liveResult?.rawValue || null;

    if (!rawValue) {
      state.liveDetectedValue = "";
      state.liveDetectedCount = 0;
      state.liveLastSeenAt = 0;
      scheduleNextLiveDetection();
      return;
    }

    const isbnMatch = resolveIsbn(rawValue);
    if (!isbnMatch) {
      state.liveDetectedValue = "";
      state.liveDetectedCount = 0;
      state.liveLastSeenAt = 0;
      scheduleNextLiveDetection();
      return;
    }

    const { isbn, correctedFrom } = isbnMatch;
    const now = Date.now();
    const needsExtraConfirmation =
      Boolean(correctedFrom) || !liveResult || liveResult.source.startsWith("quagga");

    if (isbn === state.liveDetectedValue && now - state.liveLastSeenAt < 1200) {
      state.liveDetectedCount += 1;
    } else {
      state.liveDetectedValue = isbn;
      state.liveDetectedCount = 1;
    }
    state.liveLastSeenAt = now;

    const requiredCount = needsExtraConfirmation ? 2 : 1;

    if (state.liveDetectedCount < requiredCount) {
      setStatus("Barcode found. Hold still for a moment while I confirm it...", "info");
      scheduleNextLiveDetection();
      return;
    }

    await captureAndProcessDetectedFrame({
      fallbackRawValue: rawValue,
      fallbackIsbn: isbn,
    });
  } catch (error) {
    console.error(error);
    scheduleNextLiveDetection();
  } finally {
    state.liveDetectionInProgress = false;
  }
}

function resetLiveDetectionState() {
  state.liveDetectedValue = "";
  state.liveDetectedCount = 0;
  state.liveLastSeenAt = 0;
}

async function captureAndProcessDetectedFrame({ fallbackRawValue, fallbackIsbn }) {
  const previewCanvas = drawVideoFrameToCanvas(elements.video);
  const guideCanvas = drawGuideFrameToCanvas(elements.video);

  showCanvasPreview(previewCanvas);
  stopCamera();
  setStatus("Barcode locked. Capturing a still image and scanning it now...", "info");

  const capturedRawValue =
    (await detectBarcodeFromCanvas(guideCanvas)) ||
    (await detectBarcodeFromCanvas(previewCanvas)) ||
    fallbackRawValue ||
    fallbackIsbn;

  if (!capturedRawValue) {
    setStatus("I saw the barcode, but the captured frame was still unclear. Please try again.", "error");
    return;
  }

  await handleDetectedBarcode(capturedRawValue);
}

async function onManualSubmit(event) {
  event.preventDefault();
  const isbn = elements.manualInput.value.trim();
  if (!isbn) {
    setStatus("Please enter an ISBN first.", "warning");
    return;
  }

  await handleDetectedBarcode(isbn);
  elements.manualInput.value = "";
}

async function handleDetectedBarcode(rawValue) {
  const isbnMatch = resolveIsbn(rawValue);
  if (!isbnMatch) {
    setStatus("That barcode does not look like a book ISBN. Try another barcode.", "warning");
    return false;
  }

  const { isbn, correctedFrom } = isbnMatch;

  const now = Date.now();
  if (state.lookupInProgress || (isbn === state.lastIsbn && now - state.lastIsbnAt < 4000)) {
    return false;
  }

  state.lookupInProgress = true;
  state.lastIsbn = isbn;
  state.lastIsbnAt = now;
  const lookupMessage = correctedFrom
    ? `Read a close barcode match and corrected it to ISBN ${isbn}. Looking up the book now...`
    : `Looking up book information for ISBN ${isbn}...`;
  setStatus(lookupMessage, "info");

  try {
    const existingBook = getActiveBooks().find((book) => book.isbn === isbn);
    if (existingBook) {
      existingBook.scannedAt = new Date().toISOString();
      await saveActiveLibrary(existingBook);
      renderLibrary();
      setStatus(`"${existingBook.title}" is already in Your Library. Its scan time was refreshed.`, "success");
      return true;
    }

    const book = await lookupBookByIsbn(isbn);
    await addBookToActiveLibrary({
      id: getId(),
      isbn,
      title: book.title,
      authors: book.authors,
      cover: book.cover,
      coverOptions: book.coverOptions,
      publisher: book.publisher,
      publishedDate: book.publishedDate,
      description: book.description,
      scannedAt: new Date().toISOString(),
    });
    renderLibrary();
    setStatus(`Added "${book.title}" by ${book.authors.join(", ")} to Your Library.`, "success");
    return true;
  } catch (error) {
    console.error(error);
    state.lastIsbn = "";
    state.lastIsbnAt = 0;

    if (error instanceof Error && error.message === "Shared library is not ready.") {
      setStatus("The selected shared library is not ready yet. Open that library once, then try scanning again.", "error");
      return false;
    }

    setStatus(
      "The barcode was read, but the book was not added. Try scanning it once more or enter the ISBN manually.",
      "error"
    );
    return false;
  } finally {
    state.lookupInProgress = false;
  }
}

async function lookupBookByIsbn(isbn) {
  const [googleResult, openLibraryResult] = await Promise.allSettled([
    fetchGoogleBook(isbn),
    fetchOpenLibraryBook(isbn),
  ]);

  const googleBook = googleResult.status === "fulfilled" ? googleResult.value : null;
  const openLibraryBook = openLibraryResult.status === "fulfilled" ? openLibraryResult.value : null;

  if (!googleBook && !openLibraryBook) {
    throw new Error("No matching book data found.");
  }

  return {
    title: googleBook?.title || openLibraryBook?.title || "Unknown Title",
    authors: googleBook?.authors || openLibraryBook?.authors || ["Unknown Author"],
    publisher: googleBook?.publisher || openLibraryBook?.publisher || "Unknown Publisher",
    publishedDate: googleBook?.publishedDate || openLibraryBook?.publishedDate || "Unknown Date",
    description: googleBook?.description || openLibraryBook?.description || "",
    cover: pickFirstCoverUrl(googleBook?.coverOptions, openLibraryBook?.coverOptions, [
      `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-L.jpg`,
      `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-M.jpg`,
      `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-S.jpg`,
    ]),
    coverOptions: uniqueCoverUrls(
      googleBook?.coverOptions || [],
      openLibraryBook?.coverOptions || [],
      [
        `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-L.jpg`,
        `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-M.jpg`,
        `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-S.jpg`,
      ]
    ),
  };
}

async function fetchGoogleBook(isbn) {
  const response = await fetch(
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}`
  );
  if (!response.ok) {
    throw new Error("Google Books lookup failed.");
  }

  const data = await response.json();
  const info = data.items?.[0]?.volumeInfo;
  if (!info) {
    throw new Error("Google Books returned no result.");
  }

  return {
    title: info.title,
    authors: info.authors?.length ? info.authors : ["Unknown Author"],
    publisher: info.publisher || "",
    publishedDate: info.publishedDate || "",
    description: info.description || "",
    coverOptions: uniqueCoverUrls([
      normalizeCoverUrl(info.imageLinks?.large || ""),
      normalizeCoverUrl(info.imageLinks?.medium || ""),
      normalizeCoverUrl(info.imageLinks?.small || ""),
      normalizeCoverUrl(info.imageLinks?.thumbnail || ""),
      normalizeCoverUrl(info.imageLinks?.smallThumbnail || ""),
    ]),
  };
}

async function fetchOpenLibraryBook(isbn) {
  const response = await fetch(
    `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&format=json&jscmd=data`
  );
  if (!response.ok) {
    throw new Error("Open Library lookup failed.");
  }

  const data = await response.json();
  const info = data[`ISBN:${isbn}`];
  if (!info) {
    throw new Error("Open Library returned no result.");
  }

  return {
    title: info.title,
    authors: info.authors?.length ? info.authors.map((author) => author.name) : ["Unknown Author"],
    publisher: info.publishers?.[0]?.name || "",
    publishedDate: info.publish_date || "",
    description: typeof info.notes === "string" ? info.notes : "",
    coverOptions: uniqueCoverUrls([
      info.cover?.large || "",
      info.cover?.medium || "",
      info.cover?.small || "",
    ]),
  };
}

async function detectBarcodeFromCanvas(sourceCanvas) {
  const candidates = buildScanCandidates(sourceCanvas);

  for (const candidate of candidates) {
    const detectorValue = await detectWithBarcodeDetector(candidate.canvas);
    if (detectorValue) {
      return detectorValue;
    }

    const quaggaValue = await detectWithQuagga(candidate.canvas);
    if (quaggaValue) {
      return quaggaValue;
    }
  }

  return null;
}

async function detectLiveBarcode() {
  const guideCanvas = drawGuideFrameToCanvas(elements.video);

  const detectorVideoValue = await detectWithBarcodeDetector(elements.video);
  if (detectorVideoValue) {
    return { rawValue: detectorVideoValue, source: "detector-video" };
  }

  const detectorGuideValue = await detectWithBarcodeDetector(guideCanvas);
  if (detectorGuideValue) {
    return { rawValue: detectorGuideValue, source: "detector-guide" };
  }

  const detectorContrastValue = await detectWithBarcodeDetector(createContrastCanvas(guideCanvas, 1.25, 10));
  if (detectorContrastValue) {
    return { rawValue: detectorContrastValue, source: "detector-contrast" };
  }

  const quaggaGuideValue = await detectWithQuagga(guideCanvas, true);
  if (quaggaGuideValue) {
    return { rawValue: quaggaGuideValue, source: "quagga-guide" };
  }

  const quaggaContrastValue = await detectWithQuagga(createGrayscaleCanvas(guideCanvas, 1.45, 12), true);
  if (quaggaContrastValue) {
    return { rawValue: quaggaContrastValue, source: "quagga-contrast" };
  }

  return null;
}

function buildScanCandidates(sourceCanvas) {
  const base = normalizeCanvas(sourceCanvas);
  const crops = [
    { x: 0, y: 0, width: 1, height: 1 },
    { x: 0.06, y: 0.2, width: 0.88, height: 0.6 },
    { x: 0.04, y: 0.34, width: 0.92, height: 0.28 },
    { x: 0.1, y: 0.3, width: 0.8, height: 0.4 },
  ];
  const variants = [];

  for (const crop of crops) {
    const cropped = cropCanvas(base, crop);
    variants.push({ canvas: cropped });
    variants.push({ canvas: createContrastCanvas(cropped, 1.2, 8) });
    variants.push({ canvas: createContrastCanvas(cropped, 1.45, 18) });
    variants.push({ canvas: createGrayscaleCanvas(cropped, 1.55, 10) });
  }

  return variants;
}

async function detectWithBarcodeDetector(source) {
  if (!state.detector) {
    return null;
  }

  try {
    const detected = await state.detector.detect(source);
    return detected[0]?.rawValue || null;
  } catch (error) {
    console.error(error);
    if (!(source instanceof HTMLCanvasElement)) {
      return null;
    }
  }

  return null;
}

function detectWithQuagga(candidateCanvas, isLiveScan = false) {
  if (typeof window.Quagga?.decodeSingle !== "function") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    window.Quagga.decodeSingle(
      {
        src: candidateCanvas.toDataURL("image/jpeg", 0.95),
        locate: true,
        numOfWorkers: 0,
        inputStream: {
          size: Math.max(candidateCanvas.width, candidateCanvas.height),
        },
        locator: {
          patchSize: isLiveScan ? "small" : "medium",
          halfSample: isLiveScan,
        },
        decoder: {
          readers: ["ean_reader", "ean_8_reader", "upc_reader", "upc_e_reader", "code_128_reader"],
          multiple: false,
        },
      },
      (result) => {
        resolve(result?.codeResult?.code || null);
      }
    );
  });
}

function drawVideoFrameToCanvas(video) {
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const scale = Math.min(1, MAX_SCAN_DIMENSION / Math.max(width, height));

  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function drawGuideFrameToCanvas(video) {
  const videoWidth = video.videoWidth || 1280;
  const videoHeight = video.videoHeight || 720;
  const sourceX = Math.round(videoWidth * 0.06);
  const sourceY = Math.round(videoHeight * 0.28);
  const sourceWidth = Math.round(videoWidth * 0.88);
  const sourceHeight = Math.round(videoHeight * 0.44);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const scale = Math.min(1, MAX_SCAN_DIMENSION / Math.max(sourceWidth, sourceHeight));

  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  context.drawImage(
    video,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height
  );
  return canvas;
}

async function loadFileIntoCanvas(file) {
  const bitmap = await createImageBitmap(file);

  try {
    const scale = Math.min(1, MAX_SCAN_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    if (typeof bitmap.close === "function") {
      bitmap.close();
    }
  }
}

function normalizeCanvas(sourceCanvas) {
  const scale = Math.min(1, MAX_SCAN_DIMENSION / Math.max(sourceCanvas.width, sourceCanvas.height));
  if (scale === 1) {
    return cloneCanvas(sourceCanvas);
  }

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });

  canvas.width = Math.max(1, Math.round(sourceCanvas.width * scale));
  canvas.height = Math.max(1, Math.round(sourceCanvas.height * scale));
  context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function cropCanvas(sourceCanvas, crop) {
  const sx = Math.round(sourceCanvas.width * crop.x);
  const sy = Math.round(sourceCanvas.height * crop.y);
  const sw = Math.max(1, Math.round(sourceCanvas.width * crop.width));
  const sh = Math.max(1, Math.round(sourceCanvas.height * crop.height));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });

  canvas.width = sw;
  canvas.height = sh;
  context.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas;
}

function createContrastCanvas(sourceCanvas, contrast = 1.2, brightness = 0) {
  const canvas = cloneCanvas(sourceCanvas);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;

  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = clampColor((pixels[index] - 128) * contrast + 128 + brightness);
    pixels[index + 1] = clampColor((pixels[index + 1] - 128) * contrast + 128 + brightness);
    pixels[index + 2] = clampColor((pixels[index + 2] - 128) * contrast + 128 + brightness);
  }

  context.putImageData(imageData, 0, 0);
  return canvas;
}

function createGrayscaleCanvas(sourceCanvas, contrast = 1.35, brightness = 0) {
  const canvas = cloneCanvas(sourceCanvas);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;

  for (let index = 0; index < pixels.length; index += 4) {
    const grayscale =
      pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
    const boosted = clampColor((grayscale - 128) * contrast + 128 + brightness);
    pixels[index] = boosted;
    pixels[index + 1] = boosted;
    pixels[index + 2] = boosted;
  }

  context.putImageData(imageData, 0, 0);
  return canvas;
}

function cloneCanvas(sourceCanvas) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;
  context.drawImage(sourceCanvas, 0, 0);
  return canvas;
}

function clampColor(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function showCanvasPreview(canvas) {
  clearPreview();
  const previewUrl = canvas.toDataURL("image/jpeg", 0.92);
  elements.preview.src = previewUrl;
  elements.preview.hidden = false;
  elements.placeholder.hidden = true;
}

function clearPreview() {
  elements.preview.hidden = true;
  elements.preview.removeAttribute("src");

  if (!state.cameraActive) {
    elements.placeholder.hidden = false;
  }
}

function canScanBooks() {
  return Boolean(state.detector || typeof window.Quagga?.decodeSingle === "function");
}

function canUseLiveCamera() {
  return Boolean(canScanBooks() && navigator.mediaDevices?.getUserMedia);
}

function renderLibrary() {
  const allBooks = getSortedBooks(getActiveBooks());
  const filteredBooks = filterBooks(allBooks);
  elements.bookCount.textContent = String(allBooks.length);

  if (!allBooks.length) {
    elements.libraryGrid.innerHTML = `
      <div class="empty-state">
        <h3>Your shelf is waiting</h3>
        <p>
          Scan your first book barcode and it will appear here with its title, author,
          and cover information.
        </p>
      </div>
    `;
    return;
  }

  if (!filteredBooks.length) {
    elements.libraryGrid.innerHTML = `
      <div class="empty-state">
        <h3>No matches yet</h3>
        <p>Try a different title or author search to find books in this library.</p>
      </div>
    `;
    return;
  }

  elements.libraryGrid.innerHTML = filteredBooks
    .map((book) => {
      const authors = book.authors?.join(", ") || "Unknown Author";
      const published = book.publishedDate || "Unknown date";
      const publisher = book.publisher || "Unknown publisher";
      const scannedAt = formatDate(book.scannedAt);
      const isbnCoverFallbacks = book.isbn
        ? [
            `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(book.isbn)}-L.jpg`,
            `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(book.isbn)}-M.jpg`,
            `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(book.isbn)}-S.jpg`,
          ]
        : [];
      const coverOptions = Array.isArray(book.coverOptions)
        ? uniqueCoverUrls(book.coverOptions, [book.cover || ""], isbnCoverFallbacks)
        : uniqueCoverUrls([book.cover || ""], isbnCoverFallbacks);
      const primaryCover = coverOptions[0] || "";
      const placeholderMarkup = `<div class="book-cover-fallback"${primaryCover ? " hidden" : ""}><span>${escapeHtml(
        book.title.slice(0, 32)
      )}</span></div>`;
      const coverMarkup = primaryCover
        ? `
          <div class="book-cover">
            <img
              src="${escapeHtml(primaryCover)}"
              alt="Cover of ${escapeHtml(book.title)}"
              loading="lazy"
              data-cover-list="${escapeHtml(JSON.stringify(coverOptions))}"
              data-cover-index="0"
            />
            ${placeholderMarkup}
          </div>
        `
        : `
          <div class="book-cover">
            ${placeholderMarkup}
          </div>
        `;

      return `
        <article class="book-card">
          ${coverMarkup}
          <div>
            <h3 class="book-title">${escapeHtml(book.title)}</h3>
            <p class="book-author">${escapeHtml(authors)}</p>
            <p class="book-meta">
              ISBN: ${escapeHtml(book.isbn)}<br />
              Published: ${escapeHtml(published)}<br />
              Publisher: ${escapeHtml(publisher)}
            </p>
            <div class="book-footer">
              <span>Scanned ${escapeHtml(scannedAt)}</span>
              <button class="book-remove" type="button" data-remove-id="${escapeHtml(book.id)}">
                Remove
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function onLibraryAction(event) {
  const button = event.target.closest("[data-remove-id]");
  if (!button) {
    return;
  }

  const { removeId } = button.dataset;
  removeBookFromActiveLibrary(removeId);
}

function onLibraryImageError(event) {
  const image = event.target;
  if (!(image instanceof HTMLImageElement)) {
    return;
  }

  const coverListRaw = image.dataset.coverList || "[]";
  let coverList = [];

  try {
    coverList = JSON.parse(coverListRaw);
  } catch (error) {
    console.error(error);
  }

  const currentIndex = Number(image.dataset.coverIndex || "0");
  const nextIndex = currentIndex + 1;

  if (Array.isArray(coverList) && nextIndex < coverList.length) {
    image.dataset.coverIndex = String(nextIndex);
    image.src = coverList[nextIndex];
    return;
  }

  image.hidden = true;
  const fallback = image.nextElementSibling;
  if (fallback instanceof HTMLElement) {
    fallback.hidden = false;
  }
}

function getActiveBooks() {
  const currentLibrary = getCurrentLibraryEntry();
  return currentLibrary?.type === "shared" ? Array.from(state.sharedBooksMap.values()) : state.library;
}

function getSortedBooks(books) {
  return [...books].sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt));
}

function filterBooks(books) {
  return books.filter((book) => {
    const titleMatch = !state.titleQuery || String(book.title || "").toLowerCase().includes(state.titleQuery);
    const authorText = Array.isArray(book.authors) ? book.authors.join(" ") : String(book.authors || "");
    const authorMatch = !state.authorQuery || authorText.toLowerCase().includes(state.authorQuery);
    return titleMatch && authorMatch;
  });
}

async function addBookToActiveLibrary(book) {
  const normalizedBook = normalizeSharedBook(book, book.id);
  const currentLibrary = getCurrentLibraryEntry();

  if (currentLibrary?.type === "shared") {
    if (!currentLibrary.code || !state.gun) {
      throw new Error("Shared library is not ready.");
    }

    state.sharedBooksMap.set(normalizedBook.id, normalizedBook);
    state.gun
      .get(SHARED_LIBRARY_ROOT)
      .get(currentLibrary.code)
      .get("books")
      .get(normalizedBook.id)
      .put(normalizedBook);
    return;
  }

  state.library.unshift(normalizedBook);
  saveLibrary();
}

async function saveActiveLibrary(updatedBook = null) {
  const currentLibrary = getCurrentLibraryEntry();

  if (currentLibrary?.type === "shared") {
    if (!currentLibrary.code || !state.gun) {
      throw new Error("Shared library is not ready.");
    }

    if (updatedBook?.id) {
      const normalizedBook = normalizeSharedBook(updatedBook, updatedBook.id);
      state.sharedBooksMap.set(normalizedBook.id, normalizedBook);
      state.gun
        .get(SHARED_LIBRARY_ROOT)
        .get(currentLibrary.code)
        .get("books")
        .get(normalizedBook.id)
        .put(normalizedBook);
    }
    return;
  }

  saveLibrary();
}

function removeBookFromActiveLibrary(bookId) {
  const currentLibrary = getCurrentLibraryEntry();

  if (currentLibrary?.type === "shared") {
    if (!currentLibrary.code || !state.gun) {
      setStatus("That shared library is not ready right now. Try reopening it and then remove the book again.", "error");
      return;
    }

    state.sharedBooksMap.delete(bookId);
    state.gun.get(SHARED_LIBRARY_ROOT).get(currentLibrary.code).get("books").get(bookId).put(null);
  } else {
    state.library = state.library.filter((book) => book.id !== bookId);
    saveLibrary();
  }

  renderLibrary();
  setStatus("The book was removed from Your Library.", "info");
}

function clearActiveLibrary() {
  const currentLibrary = getCurrentLibraryEntry();

  if (currentLibrary?.type === "shared") {
    if (!currentLibrary.code || !state.gun) {
      setStatus("That shared library is not ready right now. Try reopening it and then clear it again.", "error");
      return;
    }

    for (const book of getActiveBooks()) {
      state.gun.get(SHARED_LIBRARY_ROOT).get(currentLibrary.code).get("books").get(book.id).put(null);
    }
    state.sharedBooksMap = new Map();
  } else {
    state.library = [];
    saveLibrary();
  }

  renderLibrary();
  setStatus("Your Library has been cleared.", "info");
}

function clearLibrary() {
  if (!getActiveBooks().length) {
    setStatus("Your Library is already empty.", "info");
    return;
  }

  const confirmed = window.confirm("Clear every saved book from Your Library?");
  if (!confirmed) {
    return;
  }

  clearActiveLibrary();
}

function saveLibrary() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.library));
}

function persistAppState() {
  localStorage.setItem(
    APP_STATE_KEY,
    JSON.stringify({
      activeLibraryType: state.activeLibraryType,
      activeSharedCode: state.activeSharedCode,
    })
  );
}

function loadAppState() {
  try {
    const saved = localStorage.getItem(APP_STATE_KEY);
    const parsed = saved ? JSON.parse(saved) : {};
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch (error) {
    console.error(error);
    return {};
  }
}

function loadLibrary() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(error);
    return [];
  }
}

function sortLibrary() {
  state.library.sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt));
}

function normalizeSharedBook(book, fallbackId) {
  return {
    id: book.id || fallbackId || getId(),
    isbn: book.isbn || "",
    title: book.title || "Unknown Title",
    authors: Array.isArray(book.authors) ? book.authors : [book.authors || "Unknown Author"],
    cover: book.cover || "",
    coverOptions: uniqueCoverUrls(book.coverOptions || [], [book.cover || ""]),
    publisher: book.publisher || "",
    publishedDate: book.publishedDate || "",
    description: book.description || "",
    scannedAt: book.scannedAt || new Date().toISOString(),
  };
}

function setStatus(message, type = "info") {
  elements.status.textContent = message;
  elements.status.className = `status status-${type}`;
}

function extractIsbn(rawValue) {
  const value = String(rawValue || "")
    .toUpperCase()
    .replace(/[^0-9X]/g, "");

  if (!value) {
    return null;
  }

  if (value.length === 13 && isValidIsbn13(value)) {
    return value;
  }

  if (value.length === 10 && isValidIsbn10(value)) {
    return value;
  }

  const isbn13Matches = value.match(/97[89][0-9]{10}/g) || [];
  for (const candidate of isbn13Matches) {
    if (isValidIsbn13(candidate)) {
      return candidate;
    }
  }

  const isbn10Matches = value.match(/[0-9]{9}[0-9X]/g) || [];
  for (const candidate of isbn10Matches) {
    if (isValidIsbn10(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveIsbn(rawValue) {
  const candidates = getIsbnCandidates(rawValue);

  for (const candidate of candidates) {
    if (candidate.kind === "isbn13" && isValidIsbn13(candidate.value)) {
      return { isbn: candidate.value };
    }

    if (candidate.kind === "isbn10" && isValidIsbn10(candidate.value)) {
      return { isbn: candidate.value };
    }
  }

  for (const candidate of candidates) {
    if (candidate.kind.startsWith("isbn13")) {
      const corrected = correctIsbn13(candidate.value);
      if (corrected) {
        return { isbn: corrected, correctedFrom: candidate.value };
      }
    }

    if (candidate.kind.startsWith("isbn10")) {
      const corrected = correctIsbn10(candidate.value);
      if (corrected) {
        return { isbn: corrected, correctedFrom: candidate.value };
      }
    }
  }

  return null;
}

function getIsbnCandidates(rawValue) {
  const value = String(rawValue || "")
    .toUpperCase()
    .replace(/[^0-9X]/g, "");
  const seen = new Set();
  const candidates = [];

  const pushCandidate = (candidate, kind) => {
    if (!candidate || seen.has(`${kind}:${candidate}`)) {
      return;
    }

    seen.add(`${kind}:${candidate}`);
    candidates.push({ value: candidate, kind });
  };

  if (value.length === 13) {
    pushCandidate(value, "isbn13");
  }

  if (value.length === 10) {
    pushCandidate(value, "isbn10");
  }

  const isbn13Matches = value.match(/97[89][0-9]{10}/g) || [];
  for (const candidate of isbn13Matches) {
    pushCandidate(candidate, "isbn13");
  }

  const isbn10Matches = value.match(/[0-9]{9}[0-9X]/g) || [];
  for (const candidate of isbn10Matches) {
    pushCandidate(candidate, "isbn10");
  }

  const bookland12Matches = value.match(/97[89][0-9]{9}/g) || [];
  for (const candidate of bookland12Matches) {
    pushCandidate(candidate, "isbn13-partial");
  }

  const isbn9Matches = value.match(/[0-9]{9}/g) || [];
  for (const candidate of isbn9Matches) {
    pushCandidate(candidate, "isbn10-partial");
  }

  return candidates;
}

function correctIsbn13(value) {
  const digits = String(value || "").replace(/\D/g, "");

  if (/^(978|979)\d{10}$/.test(digits)) {
    return digits.slice(0, 12) + computeIsbn13CheckDigit(digits.slice(0, 12));
  }

  if (/^(978|979)\d{9}$/.test(digits)) {
    return digits + computeIsbn13CheckDigit(digits);
  }

  return null;
}

function correctIsbn10(value) {
  const isbn = String(value || "").toUpperCase();

  if (/^\d{9}[\dX]$/.test(isbn)) {
    return isbn.slice(0, 9) + computeIsbn10CheckDigit(isbn.slice(0, 9));
  }

  if (/^\d{9}$/.test(isbn)) {
    return isbn + computeIsbn10CheckDigit(isbn);
  }

  return null;
}

function computeIsbn13CheckDigit(firstTwelveDigits) {
  const total = firstTwelveDigits
    .split("")
    .reduce((sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);

  return String((10 - (total % 10)) % 10);
}

function computeIsbn10CheckDigit(firstNineDigits) {
  const total = firstNineDigits
    .split("")
    .reduce((sum, digit, index) => sum + Number(digit) * (10 - index), 0);
  const remainder = 11 - (total % 11);

  if (remainder === 10) {
    return "X";
  }

  if (remainder === 11) {
    return "0";
  }

  return String(remainder % 11);
}

function isValidIsbn13(isbn) {
  if (!/^(978|979)\d{10}$/.test(isbn)) {
    return false;
  }

  const total = isbn
    .split("")
    .slice(0, 12)
    .reduce((sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  const checkDigit = (10 - (total % 10)) % 10;

  return checkDigit === Number(isbn[12]);
}

function isValidIsbn10(isbn) {
  if (!/^\d{9}[\dX]$/.test(isbn)) {
    return false;
  }

  const total = isbn.split("").reduce((sum, char, index) => {
    const value = char === "X" ? 10 : Number(char);
    return sum + value * (10 - index);
  }, 0);

  return total % 11 === 0;
}

function normalizeCoverUrl(url) {
  return url ? url.replace(/^http:\/\//i, "https://") : "";
}

function normalizeInviteCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

function formatInviteCode(value) {
  const normalized = normalizeInviteCode(value);
  return normalized.replace(/(.{4})/g, "$1-").replace(/-$/, "");
}

function generateInviteCode() {
  const bytes = window.crypto?.getRandomValues ? window.crypto.getRandomValues(new Uint8Array(6)) : null;
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  if (bytes) {
    let code = "";
    for (const byte of bytes) {
      code += alphabet[byte % alphabet.length];
      if (code.length >= 8) {
        break;
      }
    }
    return code;
  }

  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

function uniqueCoverUrls(...groups) {
  const seen = new Set();
  const results = [];

  for (const group of groups) {
    for (const url of group || []) {
      const normalized = normalizeCoverUrl(String(url || "").trim());
      if (!normalized || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      results.push(normalized);
    }
  }

  return results;
}

function pickFirstCoverUrl(...groups) {
  return uniqueCoverUrls(...groups)[0] || "";
}

function formatDate(value) {
  if (!value) {
    return "recently";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "recently";
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `book-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function updateLibraryModeUi() {
  const currentLibrary = getCurrentLibraryEntry();
  const inSharedMode = currentLibrary?.type === "shared" && Boolean(currentLibrary.code);
  elements.leaveSharedLibraryBtn.hidden = !inSharedMode;
  elements.sharedCodeSection.hidden = !inSharedMode;
  elements.privateLibraryBtn.disabled = !inSharedMode;
  elements.sharedCodeDisplay.value = inSharedMode ? formatInviteCode(currentLibrary.code) : "";
  elements.libraryModeLabel.textContent = inSharedMode
    ? `${currentLibrary.name} - code ${formatInviteCode(currentLibrary.code)}`
    : `${currentLibrary?.name || "Private Library"} on this device`;
  elements.scannerTargetLabel.textContent = `Scanning into ${currentLibrary?.name || "Private Library"}`;
}

function renderLibrarySwitcher() {
  const currentId = state.activeLibraryId;

  elements.librarySwitcherList.innerHTML = state.libraries
    .map((library) => {
      const isActive = library.id === currentId;
      const meta = library.type === "shared" ? `Shared - ${formatInviteCode(library.code)}` : "Private - this device";

      return `
        <button class="library-switcher-item${isActive ? " is-active" : ""}" type="button" data-library-id="${escapeHtml(
          library.id
        )}" aria-pressed="${isActive ? "true" : "false"}">
          <span class="library-switcher-name">${escapeHtml(library.name)}</span>
          <span class="library-switcher-meta">${escapeHtml(meta)}</span>
        </button>
      `;
    })
    .join("");
}

function onLibrarySwitcherClick(event) {
  const button = event.target.closest("[data-library-id]");
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  const { libraryId } = button.dataset;
  if (!libraryId) {
    return;
  }

  const keepScannerOpen = state.activePage === "scanner";
  const isCurrentLibrary = libraryId === state.activeLibraryId;

  if (keepScannerOpen && !isCurrentLibrary) {
    activateLibrary(libraryId, { switchPage: false });

    const selectedLibrary = state.libraries.find((library) => library.id === libraryId);
    if (selectedLibrary) {
      setStatus(
        `Scanner target set to ${selectedLibrary.name}. Click it again if you want to open that library.`,
        "success"
      );
    }
    return;
  }

  activateLibrary(libraryId, { switchPage: true });

  const selectedLibrary = state.libraries.find((library) => library.id === libraryId);
  if (selectedLibrary) {
    setStatus(`Opened ${selectedLibrary.name}.`, "success");
  }
}

function closeCreateSharedLibraryModal() {
  elements.libraryNameInput.value = "";
  elements.libraryNameModal.hidden = true;
}

function createSharedLibrary(libraryName) {
  const normalizedName = libraryName.trim();
  if (!normalizedName) {
    setStatus("Shared libraries need a name before they can be created.", "warning");
    return;
  }

  let code = generateInviteCode();
  while (state.libraries.some((library) => library.type === "shared" && library.code === code)) {
    code = generateInviteCode();
  }

  const libraryEntry = {
    id: `shared-${code}`,
    type: "shared",
    code,
    name: normalizedName,
  };

  state.libraries.push(libraryEntry);
  activateLibrary(libraryEntry.id, { switchPage: true, created: true });
}

function activateLibrary(libraryId, options = {}) {
  const libraryEntry = state.libraries.find((library) => library.id === libraryId);
  if (!libraryEntry) {
    return;
  }

  if (libraryEntry.type === "shared" && !state.gun) {
    setStatus("Shared libraries are unavailable right now because the sync service did not load.", "error");
    return;
  }

  state.activeLibraryId = libraryEntry.id;
  syncDerivedLibraryState();

  if (options.switchPage !== false) {
    setActivePage("library", { stopScanner: true, persist: false });
  }

  if (libraryEntry.type === "shared") {
    connectToSharedLibrary(libraryEntry, options);
  } else {
    state.sharedBooksMap = new Map();
    state.sharedSessionId += 1;
    persistAppState();
    updateLibraryModeUi();
    updatePageUi();
    renderLibrary();
  }
}

function setActivePage(page, options = {}) {
  state.activePage = page === "library" ? "library" : "scanner";

  if (state.activePage === "library" && options.stopScanner !== false) {
    stopCamera();
    clearPreview();
  }

  if (options.persist !== false) {
    persistAppState();
  }

  updatePageUi();
}

function connectToSharedLibrary(libraryEntry, options = {}) {
  if (!state.gun) {
    setStatus("Shared libraries are unavailable right now because the sync service did not load.", "error");
    return;
  }

  const sessionId = state.sharedSessionId + 1;
  state.sharedSessionId = sessionId;
  state.sharedBooksMap = new Map();
  syncDerivedLibraryState();
  elements.inviteCodeInput.value = formatInviteCode(libraryEntry.code);
  persistAppState();
  updateLibraryModeUi();
  updatePageUi();
  renderLibrary();

  const sharedRootRef = state.gun.get(SHARED_LIBRARY_ROOT).get(libraryEntry.code);
  const sharedBooksRef = sharedRootRef.get("books");
  const sharedMetaRef = sharedRootRef.get("meta");

  if (options.created) {
    sharedMetaRef.put({
      code: libraryEntry.code,
      name: libraryEntry.name,
      updatedAt: new Date().toISOString(),
    });
  }

  sharedMetaRef.on((meta) => {
    if (sessionId !== state.sharedSessionId || libraryEntry.id !== state.activeLibraryId) {
      return;
    }

    if (meta?.name) {
      const matchingLibrary = state.libraries.find((library) => library.id === libraryEntry.id);
      if (matchingLibrary) {
        matchingLibrary.name = meta.name;
        persistAppState();
        updateLibraryModeUi();
        updatePageUi();
      }
    }
  });

  sharedBooksRef.map().on((data, key) => {
    if (sessionId !== state.sharedSessionId || state.activeSharedCode !== libraryEntry.code) {
      return;
    }

    if (!data || data === null || !data.title) {
      state.sharedBooksMap.delete(key);
    } else {
      state.sharedBooksMap.set(key, normalizeSharedBook(data, key));
    }

    renderLibrary();
  });

  setStatus(
    options.created
      ? `Shared library "${libraryEntry.name}" created. Invite people with code ${formatInviteCode(libraryEntry.code)}.`
      : options.restoring
        ? `Reconnected to ${libraryEntry.name}.`
        : options.joined
          ? `Joined ${libraryEntry.name}.`
          : `Opened ${libraryEntry.name}.`,
    "success"
  );
}

function persistAppState() {
  localStorage.setItem(
    APP_STATE_KEY,
    JSON.stringify({
      libraries: state.libraries.map((library) =>
        library.type === "shared"
          ? {
              id: library.id,
              type: "shared",
              code: library.code,
              name: library.name,
            }
          : {
              id: "private-local",
              type: "private",
              name: library.name || "Private Library",
            }
      ),
      activeLibraryId: state.activeLibraryId,
      activePage: state.activePage,
      activeLibraryType: state.activeLibraryType,
      activeSharedCode: state.activeSharedCode,
    })
  );
}
