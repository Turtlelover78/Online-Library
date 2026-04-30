# Your Library

A simple browser app that lets you tap a scan button, line a barcode up with a camera guide, take a picture, automatically look up the book title and author, and save the result into a personal library on your device.

## Features

- Guided live camera capture in supported browsers
- Barcode photo upload fallback
- Manual ISBN-10 and ISBN-13 entry
- Automatic book lookup using public book APIs
- Local storage so your scanned books stay saved after refresh

## Open the app

Open `index.html` in a browser, then tap `Scan Barcode` to launch the browser's camera. If live camera preview is available, line the barcode up with the center guide bar and tap `Take Picture`.

## Browser notes

- Chrome and Microsoft Edge have the best support for `BarcodeDetector`.
- The browser or phone controls the camera permission popup, not the app itself.
- If live camera preview is unavailable, the app falls back to the browser's photo chooser.
- If camera/photo barcode scanning is unavailable, the app still works with manual ISBN entry.
