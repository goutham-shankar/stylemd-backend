"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const node_path_1 = __importDefault(require("node:path"));
const artifacts_1 = require("@/lib/stylemd-artifacts/artifacts");
const index_1 = require("./routes/index");
const errorHandler_1 = require("./middleware/errorHandler");
function createApp() {
    const app = (0, express_1.default)();
    app.use((0, cors_1.default)());
    app.use(express_1.default.json({ limit: "50mb" }));
    app.use(express_1.default.urlencoded({ extended: true }));
    app.set("view engine", "ejs");
    app.set("views", node_path_1.default.join(__dirname, "views"));
    app.use(express_1.default.static(node_path_1.default.join(__dirname, "../../public")));
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
    app.use("/", index_1.router);
    app.use(errorHandler_1.errorHandler);
    return app;
}
