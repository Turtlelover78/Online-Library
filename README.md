# Your Library

A simple browser app that lets you scan a book barcode, automatically look up the book title and author, and save the result into a personal library on your device.

## Features

- Live camera barcode scanning in supported browsers
- Barcode photo upload fallback
- Manual ISBN-10 and ISBN-13 entry
- Automatic book lookup using public book APIs
- Local storage so your scanned books stay saved after refresh

## Open the app

Open `index.html` in a browser to use the manual ISBN entry and the barcode photo upload.

For the best live camera scanning experience, open the app from a secure page such as:

- `http://localhost`
- `https://`

Modern browsers often block camera access on plain local file pages.

## Browser notes

- Chrome and Microsoft Edge have the best support for `BarcodeDetector`.
- If live scanning is unavailable, the app still works with manual ISBN entry.
