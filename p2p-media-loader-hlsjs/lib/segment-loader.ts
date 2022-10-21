import { Events, HybridLoader } from "p2p-media-loader-core";

class SegmentLoader {
    private hybridLoader: any;
    private fetching = {};

    constructor() {
        this.initHybridLoader();
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
            const sequence = matches ? matches[1] : context.url;
            const id = `${swarmId}+${sequence}`;
            const segment = {
                id: id,
                url: context.url,
                masterSwarmId: swarmId,
                masterManifestUri: swarmId,
                sequence,
                priority: 1,
            };

            this.fetching[id] = { resolve, reject };
            this.hybridLoader.load([segment], swarmId);
        });
    }
}

const segmentLoader = new SegmentLoader();

export default segmentLoader;