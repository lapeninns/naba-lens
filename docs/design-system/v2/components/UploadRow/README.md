# UploadRow

One file in an upload, with its own honest state, progress and recovery action.

- States, in order: “Saved on this device” (neutral), “Uploading” with a progress bar (`nl-file--progress`), “Uploaded — processing” (`nl-file--progress`), “Sent for review” (`nl-file--positive`), and “Didn’t upload” with Retry (`nl-file--attention`). Use `nl-file--problem` for “Processing failed”.
- Only show “Sent for review” after the server has confirmed it. Offline is “Saved on this device”, never “Sent”.
- The bar is a `role="progressbar"` with `aria-valuenow` and a label naming the file’s position (“Uploading photo 2 of 5”). Announce completion once through a polite live region; don’t move focus.
- A failed file says the others are safe, and its Retry affects that file only.
- You provide: thumbnail, state, the label the file carries, percent while uploading, and the retry handler.
