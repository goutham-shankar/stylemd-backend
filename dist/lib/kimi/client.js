"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KimiClient = void 0;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const MAX_TOOL_RESULT_CHARS = 60000;
const MAX_DEFAULT_READ_CHARS = 120000;
const BINARY_EXTENSIONS = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".svg",
    ".zip",
    ".gz",
    ".tar",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
    ".eot",
    ".pdf",
]);
function stripEmptyTextItems(items) {
    return items.filter((item) => {
        if (item.type !== "text") {
            return true;
        }
        return typeof item.text === "string" && item.text.trim().length > 0;
    });
}
function truncateForToolMessage(content) {
    if (content.length <= MAX_TOOL_RESULT_CHARS) {
        return content;
    }
    return `${content.slice(0, MAX_TOOL_RESULT_CHARS)}\n...[truncated ${content.length - MAX_TOOL_RESULT_CHARS} chars]`;
}
function normalizeAssistantContent(message) {
    const contentArray = Array.isArray(message.content)
        ? message.content
        : typeof message.content === "string"
            ? [{ type: "text", text: message.content }]
            : [];
    if (!message.tool_calls || message.tool_calls.length === 0) {
        return contentArray;
    }
    const toolItems = message.tool_calls.map((toolCall) => {
        let parsedArgs = {};
        try {
            parsedArgs = JSON.parse(toolCall.function.arguments || "{}");
        }
        catch {
            parsedArgs = {};
        }
        return {
            type: "tool_use",
            id: toolCall.id,
            name: toolCall.function.name,
            input: parsedArgs,
        };
    });
    return [...contentArray, ...toolItems];
}
function sleep(ms) {
    return new Promise((resolvePromise) => {
        setTimeout(resolvePromise, ms);
    });
}
/**
 * Kimi AI client using OpenAI-compatible API
 * Uses k2-thinking for unlimited reasoning steps
 */
class KimiClient {
    constructor(apiKey) {
        this.baseURL = "https://api.moonshot.ai/v1";
        this.model = "kimi-k2-thinking";
        this.maxApiRetries = 2;
        this.apiKey = apiKey || process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY || "";
        if (!this.apiKey) {
            throw new Error("KIMI_API_KEY or MOONSHOT_API_KEY environment variable not set");
        }
    }
    /**
     * Execute a tool based on name and arguments
     */
    async executeTool(name, args, workspaceDir) {
        const baseResolved = (0, node_path_1.resolve)(workspaceDir);
        switch (name) {
            case "Read":
                return this.toolRead(baseResolved, args);
            case "Grep":
                return this.toolGrep(baseResolved, args);
            case "Glob":
                return this.toolGlob(baseResolved, args);
            case "LS":
                return this.toolLS(baseResolved, args);
            default:
                return `Tool not found: ${name}`;
        }
    }
    /**
     * Read file contents
     */
    async toolRead(baseDir, args) {
        const filePath = (0, node_path_1.resolve)(baseDir, String(args.file_path || ""));
        if (!filePath.startsWith(baseDir)) {
            return `Error: Path ${args.file_path} outside workspace`;
        }
        if (BINARY_EXTENSIONS.has((0, node_path_1.extname)(filePath).toLowerCase())) {
            return `Error: Cannot Read binary file '${args.file_path}'. Use text/json artifacts only.`;
        }
        try {
            const content = await (0, promises_1.readFile)(filePath, "utf-8");
            const parsedOffset = Number(args.offset);
            const parsedLimit = Number(args.limit);
            const offset = Number.isFinite(parsedOffset) ? Math.max(0, Math.floor(parsedOffset)) : 0;
            const limit = Number.isFinite(parsedLimit)
                ? Math.max(0, Math.floor(parsedLimit))
                : Math.min(content.length, MAX_DEFAULT_READ_CHARS);
            if (offset >= content.length || limit === 0) {
                return "";
            }
            if (offset > 0 || limit < content.length) {
                const sliced = content.slice(offset, offset + limit);
                const truncatedNote = !Number.isFinite(parsedLimit) && offset + limit < content.length
                    ? `\n...[truncated; use Read with offset+limit for more]`
                    : "";
                return `${sliced}${truncatedNote}`;
            }
            return content;
        }
        catch (err) {
            return `Error reading ${args.file_path}: ${err instanceof Error ? err.message : String(err)}`;
        }
    }
    /**
     * Search for pattern in files
     */
    async toolGrep(baseDir, args) {
        const pattern = String(args.pattern || "");
        const filePath = String(args.file_path || "");
        if (!filePath) {
            return "Error: file_path required";
        }
        const resolved = (0, node_path_1.resolve)(baseDir, filePath);
        if (!resolved.startsWith(baseDir)) {
            return `Error: Path ${filePath} outside workspace`;
        }
        try {
            const content = await (0, promises_1.readFile)(resolved, "utf-8");
            const regex = new RegExp(pattern, "gm");
            const matches = content.match(regex) || [];
            return matches.length > 0 ? matches.join("\n") : "No matches found";
        }
        catch (err) {
            return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
    }
    /**
     * List files matching glob pattern
     */
    async toolGlob(baseDir, args) {
        const pattern = String(args.pattern || "**/*");
        const maxResults = Number(args.max_results || 1000);
        try {
            const results = await this.globFiles(baseDir, pattern, maxResults);
            return results.length > 0 ? results.join("\n") : "No matches";
        }
        catch (err) {
            return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
    }
    /**
     * List directory contents
     */
    async toolLS(baseDir, args) {
        const dirPath = String(args.dir_path || ".");
        const resolved = (0, node_path_1.resolve)(baseDir, dirPath);
        if (!resolved.startsWith(baseDir)) {
            return `Error: Path ${dirPath} outside workspace`;
        }
        try {
            const entries = await (0, promises_1.readdir)(resolved, { withFileTypes: true });
            const lines = entries.map((entry) => {
                const isDir = entry.isDirectory();
                return `${isDir ? "d" : "-"} ${entry.name}`;
            });
            return lines.join("\n");
        }
        catch (err) {
            return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
    }
    /**
     * Simple glob file matching
     */
    async globFiles(baseDir, pattern, maxResults) {
        const results = [];
        const traverseDir = async (dir) => {
            if (results.length >= maxResults)
                return;
            try {
                const entries = await (0, promises_1.readdir)(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (results.length >= maxResults)
                        break;
                    const fullPath = (0, node_path_1.join)(dir, entry.name);
                    const relative = fullPath.slice(baseDir.length + 1);
                    if (this.matchesGlobPattern(relative, pattern)) {
                        results.push(relative);
                    }
                    if (entry.isDirectory()) {
                        await traverseDir(fullPath);
                    }
                }
            }
            catch {
                // Skip directories we can't read
            }
        };
        await traverseDir(baseDir);
        return results;
    }
    /**
     * Simple glob pattern matching
     */
    matchesGlobPattern(path, pattern) {
        if (pattern === "**/*")
            return true;
        const parts = pattern.split("/");
        const pathParts = path.split("/");
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (part === "**") {
                // Match any number of directories
                return true;
            }
            if (i >= pathParts.length) {
                return false;
            }
            if (part !== "*" && part !== pathParts[i]) {
                return false;
            }
        }
        return pathParts.length === parts.length;
    }
    /**
     * Query Kimi with tool use
     */
    async query(systemPrompt, userMessage, workspaceDir, tools = [], options) {
        const maxSteps = options?.maxSteps || 300;
        const messages = [{ role: "user", content: userMessage }];
        const totalTokens = { input_tokens: 0, output_tokens: 0 };
        let stepCount = 0;
        while (stepCount < maxSteps) {
            stepCount++;
            const response = await this.callAPI(systemPrompt, messages, tools);
            const { choices, usage } = response;
            if (!choices || choices.length === 0) {
                console.error(`[KIMI] Unexpected API response: no choices. Keys: ${Object.keys(response).join(", ")}`);
            }
            totalTokens.input_tokens += usage.prompt_tokens;
            totalTokens.output_tokens += usage.completion_tokens;
            options?.onToken?.(totalTokens);
            if (!choices[0])
                break;
            const assistantMessage = choices[0].message;
            const contentArray = normalizeAssistantContent(assistantMessage);
            const sanitizedContentArray = stripEmptyTextItems(contentArray);
            const assistantTextItems = sanitizedContentArray.filter((item) => item.type === "text");
            // Moonshot chat/completions expects assistant message content as text, not custom tool_use parts.
            if (assistantTextItems.length > 0) {
                const assistantText = assistantTextItems
                    .map((item) => item.text ?? "")
                    .join("\n")
                    .trim();
                if (assistantText.length > 0) {
                    messages.push({ role: "assistant", content: assistantText });
                }
            }
            let hasToolUse = false;
            const toolResults = [];
            for (const item of contentArray) {
                if (item.type === "text") {
                    if (choices[0].finish_reason === "stop" && item.text && item.text.trim()) {
                        return { text: item.text, tokenUsage: totalTokens };
                    }
                }
                else if (item.type === "tool_use") {
                    hasToolUse = true;
                    const toolName = item.name || "";
                    const toolInput = item.input || {};
                    options?.onToolCall?.(toolName, toolInput);
                    const toolResult = await this.executeTool(toolName, toolInput, workspaceDir);
                    toolResults.push({
                        type: "tool_result",
                        tool_use_id: item.id || "",
                        content: truncateForToolMessage(toolResult),
                    });
                }
            }
            if (!hasToolUse || choices[0].finish_reason === "stop") {
                const lastTextItem = contentArray.find((item) => item.type === "text");
                if (lastTextItem?.text && lastTextItem.text.trim()) {
                    const responseText = lastTextItem.text.trim();
                    const looksLikeJson = responseText.startsWith("{") || responseText.startsWith("[");
                    if (looksLikeJson) {
                        return { text: responseText, tokenUsage: totalTokens };
                    }
                    // Response is natural language rather than JSON — prompt the model to emit JSON now.
                    if (stepCount < maxSteps) {
                        messages.push({
                            role: "user",
                            content: "{\"URGENT\": true, \"instruction\": \"Output ONLY valid JSON. No explanation. No thinking. JSON ONLY NOW.\", \"required_output\": {\"units\": [{\"type\": \"single\", \"component_id\": \"...\", \"study_label\": \"...\", \"reason\": \"...\"}]}}",
                        });
                        continue;
                    }
                }
                if (!hasToolUse && stepCount < maxSteps) {
                    messages.push({
                        role: "user",
                        content: "{\"CRITICAL\": true, \"OUTPUT_NOW\": \"JSON_ONLY\", \"schema\": {\"units\": [{\"type\": \"single|merge\", \"component_id\": \"string\", \"component_ids\": [\"string\", \"string\"], \"study_label\": \"string\", \"reason\": \"string\"}]}}",
                    });
                    continue;
                }
                return { text: "", tokenUsage: totalTokens };
            }
            // Add tool results to messages as plain text for OpenAI-compatible chat format.
            if (toolResults.length > 0) {
                const compactToolResults = toolResults.map((result) => ({
                    tool_use_id: result.tool_use_id,
                    content: result.content,
                }));
                messages.push({
                    role: "user",
                    content: `TOOL_RESULTS_JSON:\n${JSON.stringify(compactToolResults)}`,
                });
            }
        }
        console.warn(`[KIMI] Query reached max steps (${maxSteps})`);
        return { text: "", tokenUsage: totalTokens };
    }
    /**
     * Call Kimi API directly
     */
    async callAPI(systemPrompt, messages, tools = []) {
        const payload = {
            model: this.model,
            messages: [
                { role: "system", content: systemPrompt },
                ...messages,
            ],
            temperature: 0.7,
            top_p: 0.95,
            ...(tools.length > 0 && { tools }),
        };
        for (let attempt = 0; attempt <= this.maxApiRetries; attempt += 1) {
            let response;
            try {
                response = await fetch(`${this.baseURL}/chat/completions`, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${this.apiKey}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(payload),
                });
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (attempt < this.maxApiRetries) {
                    const backoffMs = 1500 * (attempt + 1);
                    await sleep(backoffMs);
                    continue;
                }
                throw new Error(`Kimi network error: ${message}`);
            }
            if (response.ok) {
                return (await response.json());
            }
            const errorText = await response.text();
            let parsedError = null;
            try {
                parsedError = JSON.parse(errorText);
            }
            catch {
                parsedError = null;
            }
            const errorType = parsedError?.error?.type ?? "";
            const errorMessage = parsedError?.error?.message ?? errorText;
            const isRateLimit = response.status === 429 || errorType.includes("rate_limit");
            const isTpdExhausted = errorType === "rate_limit_reached_error"
                || errorMessage.includes("TPD rate limit");
            if (isRateLimit && isTpdExhausted) {
                const normalizedMessage = `Kimi rate limit reached (TPD exhausted): ${errorMessage}`;
                console.error(`[KIMI] ${normalizedMessage}`);
                throw new Error(normalizedMessage);
            }
            if (isRateLimit && attempt < this.maxApiRetries) {
                const backoffMs = 1500 * (attempt + 1);
                await sleep(backoffMs);
                continue;
            }
            throw new Error(`Kimi API error: ${response.status} - ${errorText}`);
        }
        throw new Error("Kimi API error: retries exhausted without response");
    }
}
exports.KimiClient = KimiClient;
