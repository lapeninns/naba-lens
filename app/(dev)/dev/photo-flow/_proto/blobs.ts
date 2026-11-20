"use client"

/*
 * The chosen photo files, kept in this browser's IndexedDB under the photo's
 * id so they survive a refresh. Prototype only: nothing is sent anywhere.
 */

const DB = "nl-photo-flow"
const STORE = "files"

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const request = work(tx.objectStore(STORE))
        tx.oncomplete = () => {
          db.close()
          resolve(request.result)
        }
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
  )
}

type Kept = { type: string; bytes: ArrayBuffer }

/**
 * Stored as bytes, not as a File: Safari refuses a File or Blob in
 * IndexedDB in private tabs and some web views, but always takes bytes.
 */
export async function saveBlob(id: string, file: Blob): Promise<void> {
  const kept: Kept = { type: file.type, bytes: await file.arrayBuffer() }
  await run("readwrite", (store) => store.put(kept, id))
}

export async function loadBlob(id: string): Promise<Blob | undefined> {
  const kept = await run<Kept | undefined>("readonly", (store) => store.get(id))
  return kept ? new Blob([kept.bytes], { type: kept.type }) : undefined
}

export function deleteBlob(id: string): Promise<unknown> {
  return run("readwrite", (store) => store.delete(id))
}
