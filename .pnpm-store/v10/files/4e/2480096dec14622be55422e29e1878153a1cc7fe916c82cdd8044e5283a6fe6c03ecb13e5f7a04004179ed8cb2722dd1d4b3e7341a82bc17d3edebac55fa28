import EventEmitter from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import stream from 'node:stream/promises';
import { ERRORS, EVENTS, StreamLimiter } from '@tus/utils';
import throttle from 'lodash.throttle';
const reExtractFileID = /([^/]+)\/?$/;
const reForwardedHost = /host="?([^";]+)/;
const reForwardedProto = /proto=(https?)/;
export class BaseHandler extends EventEmitter {
    options;
    store;
    constructor(store, options) {
        super();
        if (!store) {
            throw new Error('Store must be defined');
        }
        this.store = store;
        this.options = options;
    }
    write(status, headers = {}, body) {
        const responseBody = status === 204 || status === 205 || status === 304 ? null : body;
        const res = new Response(responseBody, { headers, status });
        if (responseBody) {
            res.headers.set('Content-Length', Buffer.byteLength(responseBody, 'utf8').toString());
        }
        return res;
    }
    generateUrl(req, id) {
        const path = this.options.path === '/' ? '' : this.options.path;
        if (this.options.generateUrl) {
            // user-defined generateUrl function
            const { proto, host } = BaseHandler.extractHostAndProto(req.headers, this.options.respectForwardedHeaders);
            return this.options.generateUrl(req, {
                proto,
                host,
                path: path,
                id,
            });
        }
        // Default implementation
        if (this.options.relativeLocation) {
            return `${path}/${id}`;
        }
        const { proto, host } = BaseHandler.extractHostAndProto(req.headers, this.options.respectForwardedHeaders);
        return `${proto}://${host}${path}/${id}`;
    }
    getFileIdFromRequest(req) {
        const match = reExtractFileID.exec(req.url);
        if (!match) {
            return this.options.getFileIdFromRequest?.(req);
        }
        let id;
        try {
            id = decodeURIComponent(match[1]);
        }
        catch {
            return;
        }
        if (this.options.getFileIdFromRequest) {
            return this.options.getFileIdFromRequest(req, id);
        }
        if (this.options.path.includes(match[1]) ||
            id.includes('/') ||
            id.includes('\\') ||
            id.includes('\0')) {
            return;
        }
        return id;
    }
    static extractHostAndProto(headers, respectForwardedHeaders) {
        let proto;
        let host;
        if (respectForwardedHeaders) {
            const forwarded = headers.get('forwarded');
            if (forwarded) {
                host ??= reForwardedHost.exec(forwarded)?.[1];
                proto ??= reForwardedProto.exec(forwarded)?.[1];
            }
            const forwardHost = headers.get('x-forwarded-host');
            const forwardProto = headers.get('x-forwarded-proto');
            // @ts-expect-error we can pass undefined
            if (['http', 'https'].includes(forwardProto)) {
                proto ??= forwardProto;
            }
            host ??= forwardHost;
        }
        host ??= headers.get('host');
        proto ??= 'http';
        return { host, proto };
    }
    async getLocker(req) {
        if (typeof this.options.locker === 'function') {
            return this.options.locker(req);
        }
        return this.options.locker;
    }
    async acquireLock(req, id, context) {
        const locker = await this.getLocker(req);
        const lock = locker.newLock(id);
        await lock.lock(context.signal, () => {
            context.cancel();
        });
        return lock;
    }
    async writeToStore(webStream, upload, maxFileSize, context) {
        // Abort early if the operation has been cancelled.
        if (context.signal.aborted) {
            throw ERRORS.ABORTED;
        }
        // Create a PassThrough stream as a proxy to manage the request stream.
        // This allows for aborting the write process without affecting the incoming request stream.
        const proxy = new PassThrough();
        const nodeStream = webStream ? Readable.fromWeb(webStream) : Readable.from([]);
        let sourceError;
        let hasSourceError = false;
        // Pipe does not forward source errors to the destination.
        // Handle source errors here so that pipeline rejects,
        // without destroying underlying request.
        nodeStream.on('error', (error) => {
            sourceError = error;
            hasSourceError = true;
            nodeStream.unpipe(proxy);
            // Server handler will destroy the proxy stream if the request is aborted
            // so we only destroy the proxy if the request is still active.
            if (!context.signal.aborted) {
                proxy.destroy(error);
            }
        });
        // gracefully terminate the proxy stream when the request is aborted
        const onAbort = () => {
            nodeStream.unpipe(proxy);
            // A source error may have already destroyed the proxy stream, end only if still active.
            if (!proxy.destroyed) {
                proxy.end();
            }
        };
        context.signal.addEventListener('abort', onAbort, { once: true });
        const postReceive = this.listenerCount(EVENTS.POST_RECEIVE) > 0
            ? throttle((offset) => {
                this.emit(EVENTS.POST_RECEIVE, nodeStream, { ...upload, offset });
            }, this.options.postReceiveInterval, { leading: false })
            : undefined;
        if (postReceive) {
            let tempOffset = upload.offset;
            proxy.on('data', (chunk) => {
                tempOffset += chunk.byteLength;
                postReceive(tempOffset);
            });
        }
        try {
            // Pipe the request stream through the proxy. We use the proxy instead of the request stream directly
            // to ensure that errors in the pipeline do not cause the request stream to be destroyed,
            // which would result in a socket hangup error for the client.
            return await stream.pipeline(nodeStream.pipe(proxy), new StreamLimiter(maxFileSize), async (stream) => {
                return this.store.write(stream, upload.id, upload.offset);
            });
        }
        catch (error) {
            nodeStream.unpipe(proxy);
            const isSourceError = hasSourceError && error === sourceError;
            const isAbortError = error instanceof Error && error.name === 'AbortError';
            throw isSourceError || isAbortError ? ERRORS.ABORTED : error;
        }
        finally {
            postReceive?.cancel();
            context.signal.removeEventListener('abort', onAbort);
        }
    }
    getConfiguredMaxSize(req, id) {
        if (typeof this.options.maxSize === 'function') {
            return this.options.maxSize(req, id);
        }
        return this.options.maxSize ?? 0;
    }
    /**
     * Calculates the maximum allowed size for the body of an upload request.
     * This function considers both the server's configured maximum size and
     * the specifics of the upload, such as whether the size is deferred or fixed.
     */
    async calculateMaxBodySize(req, file, configuredMaxSize) {
        // Use the server-configured maximum size if it's not explicitly provided.
        configuredMaxSize ??= await this.getConfiguredMaxSize(req, file.id);
        // Parse the Content-Length header from the request (default to 0 if not set).
        const length = Number.parseInt(req.headers.get('content-length') || '0', 10);
        const offset = file.offset;
        const hasContentLengthSet = req.headers.get('content-length') !== null;
        const hasConfiguredMaxSizeSet = configuredMaxSize > 0;
        if (file.sizeIsDeferred) {
            // For deferred size uploads, if it's not a chunked transfer, check against the configured maximum size.
            if (hasContentLengthSet &&
                hasConfiguredMaxSizeSet &&
                offset + length > configuredMaxSize) {
                throw ERRORS.ERR_SIZE_EXCEEDED;
            }
            if (hasConfiguredMaxSizeSet) {
                return configuredMaxSize - offset;
            }
            return Number.MAX_SAFE_INTEGER;
        }
        // Check if the upload fits into the file's size when the size is not deferred.
        if (offset + length > (file.size || 0)) {
            throw ERRORS.ERR_SIZE_EXCEEDED;
        }
        if (hasContentLengthSet) {
            return length;
        }
        return (file.size || 0) - offset;
    }
}
//# sourceMappingURL=BaseHandler.js.map