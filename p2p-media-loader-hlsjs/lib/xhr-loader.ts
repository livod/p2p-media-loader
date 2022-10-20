import type { LoaderCallbacks, LoaderContext, LoaderStats, Loader, LoaderConfiguration } from "./loader";
import { Events, HybridLoader } from "p2p-media-loader-core";

const AGE_HEADER_LINE_REGEX = /^age:\s*[\d.]+\s*$/m;

class XhrLoader implements Loader<LoaderContext> {
    private xhrSetup: Function | null;
    private requestTimeout?: number;
    private retryTimeout?: number;
    private retryDelay: number;
    private config: LoaderConfiguration | null = null;
    private callbacks: LoaderCallbacks<LoaderContext> | null = null;
    public context!: LoaderContext;

    private loader: XMLHttpRequest | null = null;
    private hybridLoader: any;
    private fetching = {};
    public stats: LoaderStats;
    static getEngine: any;

    constructor(config: any /* HlsConfig */) {
        this.xhrSetup = config ? config.xhrSetup : null;
        this.stats = {
            aborted: false,
            loaded: 0,
            retry: 0,
            total: 0,
            chunkCount: 0,
            bwEstimate: 0,
            loading: { start: 0, first: 0, end: 0 },
            parsing: { start: 0, end: 0 },
            buffering: { start: 0, first: 0, end: 0 },
        };
        this.retryDelay = 0;

        this.initHybridLoader();
    }

    destroy(): void {
        this.callbacks = null;
        this.abortInternal();
        this.loader = null;
        this.config = null;
    }

    abortInternal(): void {
        const loader = this.loader;
        self.clearTimeout(this.requestTimeout);
        self.clearTimeout(this.retryTimeout);
        if (loader) {
            loader.onreadystatechange = null;
            loader.onprogress = null;
            if (loader.readyState !== 4) {
                this.stats.aborted = true;
                loader.abort();
            }
        }
    }

    abort(): void {
        this.abortInternal();
        if (this.callbacks?.onAbort) {
            this.callbacks.onAbort(this.stats, this.context, this.loader);
        }
    }

    load(context: LoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>): void {
        if (this.stats.loading.start) {
            throw new Error("Loader can only be used once.");
        }
        this.stats.loading.start = self.performance.now();
        this.context = context;
        this.config = config;
        this.callbacks = callbacks;
        this.retryDelay = config.retryDelay;
        this.loadInternal();
    }

    initHybridLoader() {
        const settings = {
            trackerAnnounce: ["ws://172.20.128.23:8053"],
            // cachedSegmentsCount: 60,
        };

        this.hybridLoader = new HybridLoader(settings);

        this.hybridLoader.on(Events.SegmentLoaded, (segment: any, peerId: any) => {
            if (this.fetching[segment.id]) {
                let message;
                const localPeerId = this.hybridLoader.getDetails().peerId;
                if (peerId) {
                    message = `localPeerId ${localPeerId}, Loading from peerId ${peerId}, segment ${segment.id}`;
                    console.log(message);
                } else {
                    message = `localPeerId ${localPeerId}, Loading from HTTP, segment ${segment.id}`;
                    console.log(message);
                }

                this.fetching[segment.id].resolve(segment.data);

                delete this.fetching[segment.id];
            }
        });

        this.hybridLoader.on(Events.SegmentError, (segment: any, error: any) => {
            if (this.fetching[segment.id]) {
                const reject = this.fetching[segment.id].reject;
                reject(error);
                delete this.fetching[segment.id];
            }

            console.log("Loading failed", segment, error);
        });

        this.hybridLoader.on(Events.PeerConnect, function (peer: any) {
            console.log(peer);
        });
    }

    loadSegments(context: any) {
        const swarmId =
            "http://ws-live-pull-hls-test.seewo.com/live/d4d33bb52d634779ae559eb96f8d8e69_720/playlist.m3u8";
        return new Promise((resolve, reject) => {
            const matches = /([a-zA-Z0-9]+).ts/.exec(context.url);
            const id = matches ? matches[1] : context.url;
            const segment = {
                id,
                url: context.url,
                masterSwarmId: swarmId,
                masterManifestUri: swarmId,
                sequence: id,
                priority: 1,
            };

            this.fetching[id] = { resolve, reject };
            this.hybridLoader.load([segment], swarmId);
        });
    }

    loadInternal(): void {
        const { config, context } = this;
        if (!config) {
            return;
        }

        if ((context as unknown as { frag: unknown }).frag) {
            this.loadSegments(context)
                .then((result: any) => {
                    const { context, stats } = this;
                    let data;
                    let len: number;
                    data = result;
                    len = data.byteLength;
                    stats.loaded = stats.total = len;

                    if (!this.callbacks) {
                        return;
                    }
                    const onProgress = this.callbacks.onProgress;
                    if (onProgress) {
                        onProgress(stats, context, data, undefined);
                    }
                    if (!this.callbacks) {
                        return;
                    }
                    const response = {
                        url: context.url,
                        data: data,
                    };

                    this.callbacks.onSuccess(response, stats, context, undefined);
                })
                .catch((e: any) => {
                    console.log(e);
                });

            // const segmentManager = XhrLoader.getEngine().segmentManager;
            // segmentManager
            //     .loadSegment(
            //         context.url,
            //         context.rangeStart === undefined ||
            //             context.rangeEnd === undefined ||
            //             !(context.rangeEnd - context.rangeStart)
            //             ? undefined
            //             : { offset: context.rangeStart, length: context.rangeEnd - context.rangeStart }
            //     )
            //     .then((result: any) => {
            //         const { context, stats } = this;
            //         let data;
            //         let len: number;
            //         data = result.content;
            //         len = data.byteLength;
            //         stats.loaded = stats.total = len;

            //         if (!this.callbacks) {
            //             return;
            //         }
            //         const onProgress = this.callbacks.onProgress;
            //         if (onProgress) {
            //             onProgress(stats, context, data, undefined);
            //         }
            //         if (!this.callbacks) {
            //             return;
            //         }
            //         const response = {
            //             url: context.url,
            //             data: data,
            //         };

            //         this.callbacks.onSuccess(response, stats, context, undefined);
            //     })
            //     .catch((e: any) => {
            //         console.log(e);
            //     });

            return;
        }

        const xhr = (this.loader = new self.XMLHttpRequest());

        const stats = this.stats;
        stats.loading.first = 0;
        stats.loaded = 0;
        const xhrSetup = this.xhrSetup;

        try {
            if (xhrSetup) {
                try {
                    xhrSetup(xhr, context.url);
                } catch (e) {
                    // fix xhrSetup: (xhr, url) => {xhr.setRequestHeader("Content-Language", "test");}
                    // not working, as xhr.setRequestHeader expects xhr.readyState === OPEN
                    xhr.open("GET", context.url, true);
                    xhrSetup(xhr, context.url);
                }
            }
            if (!xhr.readyState) {
                xhr.open("GET", context.url, true);
            }

            const headers = this.context.headers;
            if (headers) {
                for (const header in headers) {
                    xhr.setRequestHeader(header, headers[header]);
                }
            }
        } catch (e) {
            // IE11 throws an exception on xhr.open if attempting to access an HTTP resource over HTTPS
            //@ts-ignore
            this.callbacks!.onError({ code: xhr.status, text: e.message }, context, xhr);
            return;
        }

        if (context.rangeEnd) {
            xhr.setRequestHeader("Range", "bytes=" + context.rangeStart + "-" + (context.rangeEnd - 1));
        }

        xhr.onreadystatechange = this.readystatechange.bind(this);
        xhr.onprogress = this.loadprogress.bind(this);
        xhr.responseType = context.responseType as XMLHttpRequestResponseType;
        // setup timeout before we perform request
        self.clearTimeout(this.requestTimeout);
        this.requestTimeout = self.setTimeout(this.loadtimeout.bind(this), config.timeout);
        xhr.send();
    }

    readystatechange(): void {
        const { context, loader: xhr, stats } = this;
        if (!context || !xhr) {
            return;
        }
        const readyState = xhr.readyState;
        const config = this.config as LoaderConfiguration;

        // don't proceed if xhr has been aborted
        if (stats.aborted) {
            return;
        }

        // >= HEADERS_RECEIVED
        if (readyState >= 2) {
            // clear xhr timeout and rearm it if readyState less than 4
            self.clearTimeout(this.requestTimeout);
            if (stats.loading.first === 0) {
                stats.loading.first = Math.max(self.performance.now(), stats.loading.start);
            }

            if (readyState === 4) {
                xhr.onreadystatechange = null;
                xhr.onprogress = null;
                const status = xhr.status;
                // http status between 200 to 299 are all successful
                if (status >= 200 && status < 300) {
                    stats.loading.end = Math.max(self.performance.now(), stats.loading.first);
                    let data;
                    let len: number;
                    if (context.responseType === "arraybuffer") {
                        data = xhr.response;
                        len = data.byteLength;
                    } else {
                        data = xhr.responseText;
                        len = data.length;
                    }
                    stats.loaded = stats.total = len;

                    if (!this.callbacks) {
                        return;
                    }
                    const onProgress = this.callbacks.onProgress;
                    if (onProgress) {
                        onProgress(stats, context, data, xhr);
                    }
                    if (!this.callbacks) {
                        return;
                    }
                    const response = {
                        url: xhr.responseURL,
                        data: data,
                    };

                    this.callbacks.onSuccess(response, stats, context, xhr);
                } else {
                    // if max nb of retries reached or if http status between 400 and 499 (such error cannot be recovered, retrying is useless), return error
                    if (stats.retry >= config.maxRetry || (status >= 400 && status < 499)) {
                        console.error(`${status} while loading ${context.url}`);
                        this.callbacks!.onError({ code: status, text: xhr.statusText }, context, xhr);
                    } else {
                        // retry
                        console.warn(`${status} while loading ${context.url}, retrying in ${this.retryDelay}...`);
                        // abort and reset internal state
                        this.abortInternal();
                        this.loader = null;
                        // schedule retry
                        self.clearTimeout(this.retryTimeout);
                        this.retryTimeout = self.setTimeout(this.loadInternal.bind(this), this.retryDelay);
                        // set exponential backoff
                        this.retryDelay = Math.min(2 * this.retryDelay, config.maxRetryDelay);
                        stats.retry++;
                    }
                }
            } else {
                // readyState >= 2 AND readyState !==4 (readyState = HEADERS_RECEIVED || LOADING) rearm timeout as xhr not finished yet
                self.clearTimeout(this.requestTimeout);
                this.requestTimeout = self.setTimeout(this.loadtimeout.bind(this), config.timeout);
            }
        }
    }

    loadtimeout(): void {
        console.warn(`timeout while loading ${this.context.url}`);
        const callbacks = this.callbacks;
        if (callbacks) {
            this.abortInternal();
            callbacks.onTimeout(this.stats, this.context, this.loader);
        }
    }

    loadprogress(event: ProgressEvent): void {
        const stats = this.stats;

        stats.loaded = event.loaded;
        if (event.lengthComputable) {
            stats.total = event.total;
        }
    }

    getCacheAge(): number | null {
        let result: number | null = null;
        if (this.loader && AGE_HEADER_LINE_REGEX.test(this.loader.getAllResponseHeaders())) {
            const ageHeader = this.loader.getResponseHeader("age");
            result = ageHeader ? parseFloat(ageHeader) : null;
        }
        return result;
    }
}

export default XhrLoader;
