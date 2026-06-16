"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const node_path_1 = __importDefault(require("node:path"));
const api_1 = require("@bull-board/api");
const bullMQAdapter_1 = require("@bull-board/api/bullMQAdapter");
const express_2 = require("@bull-board/express");
const artifacts_1 = require("../../lib/stylemd-artifacts/artifacts");
const scrapeQueue_1 = require("../../lib/queue/scrapeQueue");
const index_1 = require("./routes/index");
const queueAdmin_1 = require("./routes/queueAdmin");
const errorHandler_1 = require("./middleware/errorHandler");
const requireAdmin_1 = require("./middleware/requireAdmin");
function createApp() {
    const app = (0, express_1.default)();
    app.use((0, cors_1.default)());
    app.use(express_1.default.json({ limit: "50mb" }));
    app.use(express_1.default.urlencoded({ extended: true }));
    app.set("view engine", "ejs");
    app.set("views", node_path_1.default.join(__dirname, "views"));
    app.use(express_1.default.static(node_path_1.default.join(__dirname, "../public")));
    // (Legacy /runs static mount removed in storage v2 — artifacts live in R2.)
    app.use("/styleguide-files/:runId", (req, res, next) => {
        const runDir = (0, artifacts_1.getStyleMdRunDir)(req.params.runId);
        express_1.default.static(runDir, {
            dotfiles: "ignore",
            index: false,
            setHeaders(res) {
                res.setHeader("Cache-Control", "no-store");
            },
        })(req, res, next);
    });
    // ── Bull Board dashboard at /admin/queues (token-gated via Authorization header).
    const bullBoardAdapter = new express_2.ExpressAdapter();
    bullBoardAdapter.setBasePath("/admin/queues");
    (0, api_1.createBullBoard)({
        queues: [new bullMQAdapter_1.BullMQAdapter(scrapeQueue_1.scrapeQueue)],
        serverAdapter: bullBoardAdapter,
    });
    app.use("/admin/queues", requireAdmin_1.requireAdmin, bullBoardAdapter.getRouter());
    // ── JSON admin API.
    app.use("/api/admin", queueAdmin_1.queueAdminRouter);
    app.use("/", index_1.router);
    app.use(errorHandler_1.errorHandler);
    return app;
}
