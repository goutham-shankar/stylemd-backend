"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_STYLEMD_PIPELINE_CONFIG = exports.STYLEMD_PIPELINE_STAGES = void 0;
exports.STYLEMD_PIPELINE_STAGES = ["capture", "extract", "dedup", "curate", "styleguide", "showcase"];
exports.DEFAULT_STYLEMD_PIPELINE_CONFIG = {
    viewport: {
        width: 1366,
        height: 900,
        deviceScaleFactor: 1,
    },
    widthThreshold: 0.95,
    minHeightPx: 10,
    dedupSsimThreshold: 1,
};
