const STORAGE_KEY = "your-library-books";

const state = {
  detector: null,
  library: loadLibrary(),
  stream: null,
  scannerActive: false,
  scanTimeoutId: null,
  lookupInProgress: false,
  lastIsbn: "",
  lastIsbnAt: 0,
};

const elements = {
  video: document.getElementById("scannerVideo"),
  canvas: document.getElementById("scannerCanvas"),
  placeholder: document.getElementById("scannerPlaceholder"),
  status: document.getElementById("statusMessage"),
  supportNote: document.getElementById("supportNote"),
  startBtn: document.getElementById("startScannerBtn"),
  stopBtn: document.getElementById("stopScannerBtn"),
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
  elements.stopBtn.addEventListener("click", stopScanner);
  elements.imageInput.addEventListener("change", onImageSelected);
  elements.manualForm.addEventListener("submit", onManualSubmit);
  elements.clearLibraryBtn.addEventListener("click", clearLibrary);
  elements.libraryGrid.addEventListener("click", onLibraryAction);
  window.addEventListener("beforeunload", stopScanner);
}

async function setupDetector() {
  if (!("BarcodeDetector" in window)) {
    setStatus(
      "Live barcode scanning is not supported in this browser. You can still upload a barcode photo or type an ISBN.",
      "warning"
    );
    elements.startBtn.disabled = true;
    return;
  }

  try {
    const preferredFormats = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"];
    const supportedFormats = BarcodeDetector.getSupportedFormats
      ? await BarcodeDetector.getSupportedFormats()
      : preferredFormats;
    const formats = preferredFormats.filter((format) => supportedFormats.includes(format));

    state.detector = new BarcodeDetector({
      formats: formats.length ? formats : preferredFormats,
    });

    setStatus(
      "Scanner ready. Start the camera, upload a barcode photo, or enter an ISBN manually.",
      "info"
    );
  } catch (error) {
    console.error(error);
    setStatus(
      "Barcode scanning could not be started in this browser. Manual ISBN entry is still available.",
      "warning"
    );
    elements.startBtn.disabled = true;
  }
}

async function startScanner() {
  if (!state.detector) {
    setStatus(
      "The live scanner is unavailable here. Try Chrome or Edge, or use the image upload and ISBN input instead.",
      "warning"
    );
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("This browser does not support camera access.", "error");
    return;
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
      },
      audio: false,
    });

    elements.video.srcObject = state.stream;
    await elements.video.play();
    state.scannerActive = true;
    elements.video.classList.add("is-active");
    elements.placeholder.hidden = true;
    elements.startBtn.disabled = true;
    elements.stopBtn.disabled = false;
    setStatus("Camera is live. Hold the barcode inside the frame.", "info");
    queueNextScan();
  } catch (error) {
    console.error(error);
    const message = window.isSecureContext
      ? "Camera access was blocked. Please allow camera permission and try again."
      : "Camera scanning needs a secure page such as http://localhost or https://.";
    setStatus(message, "error");
  }
}

function stopScanner() {
  state.scannerActive = false;

  if (state.scanTimeoutId) {
    window.clearTimeout(state.scanTimeoutId);
    state.scanTimeoutId = null;
  }

  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }

  elements.video.pause();
  elements.video.srcObject = null;
  elements.video.classList.remove("is-active");
  elements.placeholder.hidden = false;
  elements.startBtn.disabled = !state.detector;
  elements.stopBtn.disabled = true;
}

function queueNextScan() {
  if (!state.scannerActive) {
    return;
  }

  state.scanTimeoutId = window.setTimeout(scanVideoFrame, 350);
}

async function scanVideoFrame() {
  if (!state.scannerActive) {
    return;
  }

  try {
    if (
      !state.lookupInProgress &&
      state.detector &&
      elements.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      const detected = await state.detector.detect(elements.video);
      if (detected.length > 0) {
        await handleDetectedBarcode(detected[0].rawValue);
      }
    }
  } catch (error) {
    console.error(error);
  } finally {
    queueNextScan();
  }
}

async function onImageSelected(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  if (!state.detector) {
    setStatus(
      "Photo barcode reading is not supported in this browser. Please type the ISBN manually.",
      "warning"
    );
    event.target.value = "";
    return;
  }

  try {
    setStatus("Scanning the uploaded barcode image...", "info");
    const bitmap = await createImageBitmap(file);
    const detected = await state.detector.detect(bitmap);

    if (!detected.length) {
      setStatus(
        "No barcode was found in that image. Try a sharper photo or enter the ISBN manually.",
        "error"
      );
      return;
    }

    await handleDetectedBarcode(detected[0].rawValue);
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
