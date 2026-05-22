# Your Library

A browser app that scans book barcodes, looks up the title and author automatically, and saves each book into a personal or shared library.

## Features

- Guided live camera auto-scanning in supported browsers
- Barcode photo upload fallback
- Manual ISBN-10 and ISBN-13 entry
- Automatic book lookup using public book APIs
- Book cover display when a cover is available
- Search by title and author
- Private and shared libraries with invite codes
- Named shared libraries
- A sidebar to switch between the scanner and all of your libraries
- Local storage so your private shelf and library list stay saved after refresh

## Open the app

Open `index.html` in a browser. Use the left sidebar to:

- Open the scanner page
- Switch between your private library and any shared libraries you joined
- Create a new shared library

When you create a shared library, the app now asks you to name it first. That name is required and is what people will see when they join with your invite code.

## Library tools

Inside the library page you can:

- Search by title
- Search by author
- Join a shared library with an invite code
- Copy the current shared library's invite code
- Leave the current shared library
- Clear the currently open library

## Browser notes

- Chrome and Microsoft Edge have the best support for `BarcodeDetector`.
- The browser or phone controls the camera permission popup, not the app itself.
- If live camera preview is unavailable, the app falls back to the browser's photo chooser.
- If camera/photo barcode scanning is unavailable, the app still works with manual ISBN entry.
