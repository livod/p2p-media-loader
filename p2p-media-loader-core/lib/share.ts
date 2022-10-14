import { P2PMediaManager } from './p2p-media-manager';
import { SegmentsMemoryStorage } from "./segments-memory-storage";

declare global {
    interface Window {
        p2pShare: Record<string, unknown>;
    }
}

window.p2pShare = {
    P2PMediaManager,
    SegmentsMemoryStorage,
}