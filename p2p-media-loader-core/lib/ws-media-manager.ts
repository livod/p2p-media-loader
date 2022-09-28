import Debug from "debug";
import { STEEmitter } from "./stringly-typed-event-emitter";
import { Segment } from "./loader-interface";

export class WsMediaManager extends STEEmitter<"segment-loaded" | "segment-error" | "bytes-downloaded"> {
    private wsRequests = new Array<Segment>();
    private failedSegments = new Map<string, number>();
    private debug = Debug("p2pml:ws-media-manager");
    private webSocket: WebSocket;

    public constructor(
        readonly settings: {
            wsServer?: string;
            httpFailedSegmentTimeout: number;
            httpUseRanges: boolean;
        }
    ) {
        super();

        this.webSocket = this.connectWs();
    }

    connectWs() {
        const wsServer = this.settings.wsServer || "ws://wsfile.test.seewo.com";
        this.webSocket = new WebSocket(wsServer);

        this.webSocket.onopen = (openEvent) => {
            this.debug("ws open");
        };

        this.webSocket.onclose = (params) => {
            setTimeout(() => {
                this.debug("ws reconnect after close");
                this.connectWs();
            }, 200);
        };

        this.webSocket.onerror = (err: any) => {
            this.debug("Socket encountered error: ", err.message, "Closing socket");
            this.webSocket.close();
        };

        this.webSocket.onmessage = (messageEvent) => {
            var wsMsg = messageEvent.data;
            if (typeof wsMsg === "string") {
            } else {
                var arrayBuffer;
                var fileReader = new FileReader();
                fileReader.onload = (event: any) => {
                    arrayBuffer = event.target.result;
                    this.segmentDownloadFinished(arrayBuffer);
                };
                fileReader.readAsArrayBuffer(wsMsg);
            }
        };

        return this.webSocket;
    }

    public download = (segment: Segment): void => {
        if (this.isDownloading(segment)) {
            return;
        }

        this.cleanTimedOutFailedSegments();

        const segmentUrl = segment.url;

        this.debug("ws segment download", segmentUrl);
        if (!segment.wsRange) {
            this.debug("ws segment wsRange is null");
        } else {
            const { start, length } = segment.wsRange;

            this.webSocket.send(JSON.stringify({ start, length }));
            this.wsRequests.push(segment);
        }
    };

    public abort = (segment: Segment): void => {
        // this.webSocket 请求无法取消
        this.debug("ws segment try abort", segment.id);
    };

    public isDownloading = (segment: Segment): boolean => {
        return this.wsRequests.some((x: Segment) => x.id === segment.id);
    };

    public isFailed = (segment: Segment): boolean => {
        const time = this.failedSegments.get(segment.id);
        return time !== undefined && time > this.now();
    };

    public getActiveDownloads = (): ReadonlyMap<string, { segment: Segment }> => {
        const map = new Map<string, { segment: Segment }>();
        for (let i = 0; i < this.wsRequests.length; i++) {
            const segment = this.wsRequests[i];
            map.set(segment.id, { segment });
        }
        return map;
    };

    public getActiveDownloadsCount = (): number => {
        return this.wsRequests.length;
    };

    public destroy = (): void => {};

    private segmentDownloadFinished = async (data: ArrayBuffer) => {
        const segment = this.wsRequests.shift();
        this.emit("segment-loaded", segment, data);
    };

    private cleanTimedOutFailedSegments = () => {
        const now = this.now();
        const candidates: string[] = [];

        this.failedSegments.forEach((time, id) => {
            if (time < now) {
                candidates.push(id);
            }
        });

        candidates.forEach((id) => this.failedSegments.delete(id));
    };

    private now = () => performance.now();
}
