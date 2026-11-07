import EventEmitter from 'node:events';
import type stream from 'node:stream';
import { Upload } from './Upload.js';
export declare class DataStore extends EventEmitter {
    extensions: string[];
    hasExtension(extension: string): boolean;
    /**
     * Called in POST requests. This method just creates a
     * file, implementing the creation extension.
     *
     * http://tus.io/protocols/resumable-upload.html#creation
     */
    create(file: Upload): Promise<Upload>;
    /**
     * Called in DELETE requests. This method just deletes the file from the store.
     * http://tus.io/protocols/resumable-upload.html#termination
     */
    remove(_id: string): Promise<void>;
    /**
     * Called in PATCH requests. This method should write data
     * to the DataStore file, and possibly implement the
     * concatenation extension.
     *
     * http://tus.io/protocols/resumable-upload.html#concatenation
     */
    write(_stream: stream.Readable, _id: string, _offset: number): Promise<number>;
    /**
     * Called in HEAD requests. This method should return the bytes
     * writen to the DataStore, for the client to know where to resume
     * the upload.
     */
    getUpload(id: string): Promise<Upload>;
    /**
     * Called in PATCH requests when upload length is known after being defered.
     */
    declareUploadLength(_id: string, _upload_length: number): Promise<void>;
    /**
     * Returns number of expired uploads that were deleted.
     */
    deleteExpired(): Promise<number>;
    getExpiration(): number;
}
//# sourceMappingURL=DataStore.d.ts.map