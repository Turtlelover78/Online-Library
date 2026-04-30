const STORAGE_KEY = "your-library-books";

const state = {
  detector: null,
  library: loadLibrary(),
  lookupInProgress: false,
  lastIsbn: "",
  lastIsbnAt: 0,
};

const elements = {
  preview: document.getElementById("scannerPreview"),
  placeholder: document.getElementById("scannerPlaceholder"),
  status: document.getElementById("statusMessage"),
  startBtn: document.getElementById("startScannerBtn"),
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
  elements.imageInput.addEventListener("change", onImageSelected);
  elements.manualForm.addEventListener("submit", onManualSubmit);
  elements.clearLibraryBtn.addEventListener("click", clearLibrary);
  elements.libraryGrid.addEventListener("click", onLibraryAction);
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

  if (canScanFromPhoto()) {
    setStatus(
      "Scanner ready. Tap Scan Barcode to take a photo, or enter an ISBN manually.",
      "info"
    );
    return;
  }

  setStatus(
    "Barcode scanning from a photo is not supported in this browser. You can still type an ISBN manually.",
    "warning"
  );
  elements.startBtn.disabled = true;
  elements.imageInput.disabled = true;
}

function startScanner() {
  if (!canScanFromPhoto()) {
    setStatus(
      "Camera scanning is unavailable here. Try Chrome or Edge, or use the ISBN input instead.",
      "warning"
    );
    return;
  }

  try {
    clearPreview();
    setStatus("Opening your camera. If your browser asks for permission, choose the camera option you want.", "info");

    if (typeof elements.imageInput.showPicker === "function") {
      elements.imageInput.showPicker();
      return;
    }

    elements.imageInput.click();
  } catch (error) {
    console.error(error);
    setStatus("Your browser blocked the camera chooser. Try tapping the photo field below instead.", "error");
  }
}

async function onImageSelected(event) {
  const file = event.target.files?.[0];
  if (!file) {
    setStatus("Camera cancelled. Tap Scan Barcode when you want to try again.", "info");
    return;
  }

  if (!canScanFromPhoto()) {
    setStatus(
      "Photo barcode reading is not supported in this browser. Please type the ISBN manually.",
      "warning"
    );
    event.target.value = "";
    return;
  }

  try {
    showPreview(file);
    setStatus("Scanning the barcode photo...", "info");
    const rawValue = await detectBarcodeFromFile(file);

    if (!rawValue) {
      setStatus(
        "No barcode was found in that image. Try a sharper photo or enter the ISBN manually.",
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

function canScanFromPhoto() {
  return Boolean(state.detector || typeof window.Quagga?.decodeSingle === "function");
}

function showPreview(file) {
  clearPreview();
  const previewUrl = URL.createObjectURL(file);
  elements.preview.src = previewUrl;
  elements.preview.hidden = false;
  elements.placeholder.hidden = true;
  elements.preview.dataset.objectUrl = previewUrl;
}

function clearPreview() {
  const currentUrl = elements.preview.dataset.objectUrl;
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    delete elements.preview.dataset.objectUrl;
  }

  elements.preview.hidden = true;
  elements.preview.removeAttribute("src");
  elements.placeholder.hidden = false;
}

async function detectBarcodeFromFile(file) {
  const barcodeDetectorValue = await detectWithBarcodeDetector(file);
  if (barcodeDetectorValue) {
    return barcodeDetectorValue;
  }

  return detectWithQuagga();
}

async function detectWithBarcodeDetector(file) {
  if (!state.detector) {
    return null;
  }

  const bitmap = await createImageBitmap(file);

  try {
    const detected = await state.detector.detect(bitmap);
    return detected[0]?.rawValue || null;
  } finally {
    if (typeof bitmap.close === "function") {
      bitmap.close();
    }
  }
}

function detectWithQuagga() {
  if (typeof window.Quagga?.decodeSingle !== "function") {
    return Promise.resolve(null);
  }

  const imageUrl = elements.preview.dataset.objectUrl;
  if (!imageUrl) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    window.Quagga.decodeSingle(
      {
        src: imageUrl,
        locate: true,
        numOfWorkers: 0,
        inputStream: {
          size: 1000,
        },
        decoder: {
          readers: ["ean_reader", "ean_8_reader", "upc_reader", "upc_e_reader", "code_128_reader"],
        },
      },
      (result) => {
        resolve(result?.codeResult?.code || null);
      }
    );
  });
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
