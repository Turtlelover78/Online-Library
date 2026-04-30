const STORAGE_KEY = "your-library-books";
const MAX_SCAN_DIMENSION = 1800;

const state = {
  detector: null,
  library: loadLibrary(),
  lookupInProgress: false,
  lastIsbn: "",
  lastIsbnAt: 0,
  stream: null,
  cameraActive: false,
};

const elements = {
  video: document.getElementById("scannerVideo"),
  preview: document.getElementById("scannerPreview"),
  placeholder: document.getElementById("scannerPlaceholder"),
  status: document.getElementById("statusMessage"),
  startBtn: document.getElementById("startScannerBtn"),
  captureBtn: document.getElementById("capturePhotoBtn"),
  cancelBtn: document.getElementById("cancelCameraBtn"),
  imageInput: document.getElementById("barcodeImageInput"),
  manualForm: document.getElementById("manualIsbnForm"),
  manualInput: document.getElementById("manualIsbnInput"),
  libraryGrid: document.getElementById("libraryGrid"),
  bookCount: document.getElementById("bookCount"),
  clearLibraryBtn: document.getElementById("clearLibraryBtn"),
};

initialize();

async function initialize() {
  renderLibrary();
  wireEvents();
  await setupDetector();
}

function wireEvents() {
  elements.startBtn.addEventListener("click", startScanner);
  elements.captureBtn.addEventListener("click", captureCameraPhoto);
  elements.cancelBtn.addEventListener("click", cancelCamera);
  elements.imageInput.addEventListener("change", onImageSelected);
  elements.manualForm.addEventListener("submit", onManualSubmit);
  elements.clearLibraryBtn.addEventListener("click", clearLibrary);
  elements.libraryGrid.addEventListener("click", onLibraryAction);
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
      "Scanner ready. Open the camera, line the barcode up with the center bar, and take the picture.",
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
    setStatus("Requesting camera access. Then line the barcode up with the center bar and tap Take Picture.", "info");

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
    elements.captureBtn.hidden = false;
    elements.cancelBtn.hidden = false;
    setStatus("Center the barcode on the glowing line, then tap Take Picture.", "info");
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

async function captureCameraPhoto() {
  if (!state.cameraActive || elements.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    setStatus("The camera preview is not ready yet. Give it a moment and try again.", "warning");
    return;
  }

  try {
    const captureCanvas = drawVideoFrameToCanvas(elements.video);
    showCanvasPreview(captureCanvas);
    stopCamera();
    setStatus("Scanning the captured barcode photo...", "info");

    const rawValue = await detectBarcodeFromCanvas(captureCanvas);
    if (!rawValue) {
      setStatus(
        "I could not read that barcode. Try moving the barcode closer to the center line and filling more of the frame.",
        "error"
      );
      return;
    }

    await handleDetectedBarcode(rawValue);
  } catch (error) {
    console.error(error);
    stopCamera();
    setStatus("That photo could not be scanned. Try again with the barcode centered on the guide line.", "error");
  }
}

function cancelCamera() {
  stopCamera();
  clearPreview();
  setStatus("Camera cancelled. You can reopen it whenever you want to scan another book.", "info");
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }

  state.cameraActive = false;
  elements.video.pause();
  elements.video.srcObject = null;
  elements.video.hidden = true;
  elements.startBtn.hidden = false;
  elements.captureBtn.hidden = true;
  elements.cancelBtn.hidden = true;

  if (elements.preview.hidden) {
    elements.placeholder.hidden = false;
  }
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
  const isbn = extractIsbn(rawValue);
  if (!isbn) {
    setStatus("That barcode does not look like a book ISBN. Try another barcode.", "warning");
    return;
  }

  const now = Date.now();
  if (state.lookupInProgress || (isbn === state.lastIsbn && now - state.lastIsbnAt < 4000)) {
    return;
  }

  state.lookupInProgress = true;
  state.lastIsbn = isbn;
  state.lastIsbnAt = now;
  setStatus(`Looking up book information for ISBN ${isbn}...`, "info");

  try {
    const existingBook = state.library.find((book) => book.isbn === isbn);
    if (existingBook) {
      existingBook.scannedAt = new Date().toISOString();
      saveLibrary();
      sortLibrary();
      renderLibrary();
      setStatus(`"${existingBook.title}" is already in Your Library. Its scan time was refreshed.`, "success");
      return;
    }

    const book = await lookupBookByIsbn(isbn);
    state.library.unshift({
      id: getId(),
      isbn,
      title: book.title,
      authors: book.authors,
      cover: book.cover,
      publisher: book.publisher,
      publishedDate: book.publishedDate,
      description: book.description,
      scannedAt: new Date().toISOString(),
    });

    saveLibrary();
    renderLibrary();
    setStatus(`Added "${book.title}" by ${book.authors.join(", ")} to Your Library.`, "success");
  } catch (error) {
    console.error(error);
    setStatus(
      "The barcode was read, but the book information could not be found. You can try again or enter a different ISBN.",
      "error"
    );
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
    cover:
      googleBook?.cover ||
      openLibraryBook?.cover ||
      `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-L.jpg`,
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
    cover: normalizeCoverUrl(info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || ""),
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
    cover: info.cover?.large || info.cover?.medium || info.cover?.small || "",
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

async function detectWithBarcodeDetector(candidateCanvas) {
  if (!state.detector) {
    return null;
  }

  const bitmap = await createImageBitmap(candidateCanvas);

  try {
    const detected = await state.detector.detect(bitmap);
    return detected[0]?.rawValue || null;
  } catch (error) {
    console.error(error);
    return null;
  } finally {
    if (typeof bitmap.close === "function") {
      bitmap.close();
    }
  }
}

function detectWithQuagga(candidateCanvas) {
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
          patchSize: "medium",
          halfSample: false,
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
  sortLibrary();
  elements.bookCount.textContent = String(state.library.length);

  if (!state.library.length) {
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

  elements.libraryGrid.innerHTML = state.library
    .map((book) => {
      const authors = book.authors?.join(", ") || "Unknown Author";
      const published = book.publishedDate || "Unknown date";
      const publisher = book.publisher || "Unknown publisher";
      const scannedAt = formatDate(book.scannedAt);
      const coverMarkup = book.cover
        ? `
          <div class="book-cover">
            <img src="${escapeHtml(book.cover)}" alt="Cover of ${escapeHtml(book.title)}" loading="lazy" />
          </div>
        `
        : `
          <div class="book-cover-placeholder">
            <span>${escapeHtml(book.title.slice(0, 32))}</span>
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
  state.library = state.library.filter((book) => book.id !== removeId);
  saveLibrary();
  renderLibrary();
  setStatus("The book was removed from Your Library.", "info");
}

function clearLibrary() {
  if (!state.library.length) {
    setStatus("Your Library is already empty.", "info");
    return;
  }

  const confirmed = window.confirm("Clear every saved book from Your Library?");
  if (!confirmed) {
    return;
  }

  state.library = [];
  saveLibrary();
  renderLibrary();
  setStatus("Your Library has been cleared.", "info");
}

function saveLibrary() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.library));
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
