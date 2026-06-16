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
        this.model = "kimi-k2.5";
        this.maxApiRetries = 5;
        this.apiKey = apiKey || process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY || "";
        if (!this.apiKey) {
            throw new Error("KIMI_API_KEY or MOONSHOT_API_KEY environment variable not set");
        }
        console.log(`\uD83D\uDD11 [KIMI] Initialized (model: ${this.model}, baseURL: ${this.baseURL})`);
    }
    /**
     * Execute a tool based on name and arguments
     */
    async executeTool(name, args, workspaceDir) {
        const baseResolved = (0, node_path_1.resolve)(workspaceDir);
        console.log(`\uD83D\uDEE0\uFE0F  [KIMI] Executing tool: ${name}`, { args });
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
        console.log(`\uD83D\uDE80 [KIMI] Starting query with max ${maxSteps} tool steps (k2-thinking mode)`);
        console.log(`\uD83D\uDCDA [KIMI] Available tools: ${tools.map((t) => t.function.name).join(", ")}`);
        const totalTokens = { input_tokens: 0, output_tokens: 0 };
        let stepCount = 0;
        while (stepCount < maxSteps) {
            stepCount++;
            console.log(`\n\u23F3 [KIMI] Step ${stepCount}/${maxSteps}...`);
            // Call Kimi API
            const response = await this.callAPI(systemPrompt, messages, tools);
            const { choices, usage } = response;
            // DEBUG: Log response structure for debugging
            if (!choices || choices.length === 0) {
                console.error(`\u26A0\uFE0F  [KIMI] Unexpected API response structure:`);
                console.error(`   Response keys: ${Object.keys(response).join(", ")}`);
                console.error(`   Choices count: ${choices?.length ?? "undefined"}`);
                console.error(`   Full response: ${JSON.stringify(response).slice(0, 500)}`);
            }
            totalTokens.input_tokens += usage.prompt_tokens;
            totalTokens.output_tokens += usage.completion_tokens;
            options?.onToken?.(totalTokens);
            console.log(`\uD83D\uDCB0 [KIMI] Tokens - Input: ${usage.prompt_tokens}, Output: ${usage.completion_tokens}`);
            console.log(`\uD83D\uDCCA [KIMI] Cumulative - Input: ${totalTokens.input_tokens}, Output: ${totalTokens.output_tokens}`);
            if (!choices[0]) {
                console.log(`\u2705 [KIMI] No more choices, terminating`);
                break;
            }
            const assistantMessage = choices[0].message;
            const contentArray = normalizeAssistantContent(assistantMessage);
            // DEBUG: Log the assistant message structure
            console.log(`\uD83D\uDCE8 [KIMI] Assistant message structure:`);
            console.log(`   Content type: ${typeof assistantMessage.content}`);
            console.log(`   Is array: ${Array.isArray(assistantMessage.content)}`);
            if (assistantMessage.tool_calls?.length) {
                console.log(`   Tool calls: ${assistantMessage.tool_calls.length}`);
            }
            if (typeof assistantMessage.content === "string") {
                const stringContent = assistantMessage.content;
                console.log(`   String length: ${stringContent.length}`);
                console.log(`   Preview: ${stringContent.slice(0, 200)}`);
            }
            else if (Array.isArray(assistantMessage.content)) {
                const arrayContent = assistantMessage.content;
                console.log(`   Array length: ${arrayContent.length}`);
                console.log(`   Items: ${arrayContent.map((item) => item.type).join(", ")}`);
            }
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
                    // Final response text - only return if we have actual content
                    if (choices[0].finish_reason === "stop" && item.text && item.text.trim()) {
                        console.log(`\n\u2728 [KIMI] Query complete (finish_reason: stop)`);
                        return { text: item.text, tokenUsage: totalTokens };
                    }
                }
                else if (item.type === "tool_use") {
                    hasToolUse = true;
                    const toolName = item.name || "";
                    const toolInput = item.input || {};
                    console.log(`  \u2192 Tool call: ${toolName}`);
                    options?.onToolCall?.(toolName, toolInput);
                    // Execute tool
                    const toolResult = await this.executeTool(toolName, toolInput, workspaceDir);
                    toolResults.push({
                        type: "tool_result",
                        tool_use_id: item.id || "",
                        content: truncateForToolMessage(toolResult),
                    });
                    console.log(`  \u2713 Tool result: ${toolResult.slice(0, 100)}${toolResult.length > 100 ? "..." : ""}`);
                }
            }
            if (!hasToolUse || choices[0].finish_reason === "stop") {
                // Extract final text from last assistant message
                const lastTextItem = contentArray.find((item) => item.type === "text");
                if (lastTextItem?.text && lastTextItem.text.trim()) {
                    const responseText = lastTextItem.text.trim();
                    // Check if response looks like JSON (starts with { or [)
                    // If not, treat as thinking/analysis and force JSON output
                    const looksLikeJson = responseText.startsWith("{") || responseText.startsWith("[");
                    if (looksLikeJson) {
                        console.log(`\n\u2728 [KIMI] Query complete (no more tool calls)`);
                        return { text: responseText, tokenUsage: totalTokens };
                    }
                    // Response is natural language (thinking/analysis), not JSON - force JSON output
                    if (stepCount < maxSteps) {
                        console.log(`\u26A0\uFE0F  [KIMI] Response is thinking/analysis, not JSON. Forcing JSON output...`);
                        messages.push({
                            role: "user",
                            content: "{\"URGENT\": true, \"instruction\": \"Output ONLY valid JSON. No explanation. No thinking. JSON ONLY NOW.\", \"required_output\": {\"units\": [{\"type\": \"single\", \"component_id\": \"...\", \"study_label\": \"...\", \"reason\": \"...\"}]}}",
                        });
                        continue; // Continue loop to get the JSON response
                    }
                }
                // DEBUGGING: No text found - log what we got instead
                console.log(`\u26A0\uFE0F  [KIMI] No text found in response. Content array:`);
                console.log(`   Length: ${contentArray.length}`);
                console.log(`   Items: ${contentArray.map((item) => `${item.type}${item.type === "text" ? `(len=${(item.text || "").length})` : ""}`).join(", ")}`);
                console.log(`   Full content: ${JSON.stringify(contentArray).slice(0, 500)}`);
                console.log(`   Finish reason: ${choices[0].finish_reason}`);
                // If we have no text and no tool use, force JSON output
                if (!hasToolUse && stepCount < maxSteps) {
                    console.log(`\u26A0\uFE0F  [KIMI] Forcing JSON output with explicit schema...`);
                    messages.push({
                        role: "user",
                        content: "{\"CRITICAL\": true, \"OUTPUT_NOW\": \"JSON_ONLY\", \"schema\": {\"units\": [{\"type\": \"single|merge\", \"component_id\": \"string\", \"component_ids\": [\"string\", \"string\"], \"study_label\": \"string\", \"reason\": \"string\"}]}}",
                    });
                    continue;
                }
                console.log(`\n\u2728 [KIMI] Query complete (no text response)`);
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
        console.log(`\n\u26A0\uFE0F  [KIMI] Query reached max steps (${maxSteps})`);
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
            temperature: 1,
            top_p: 0.95,
            ...(tools.length > 0 && { tools }),
        };
        console.log(`\uD83D\uDE80 [KIMI] Sending request to: ${this.baseURL}/chat/completions`);
        console.log(`\uD83D\uDCDD [KIMI] Request payload keys: ${Object.keys(payload).join(", ")}`);
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
                    console.warn(`\u26A0\uFE0F  [KIMI] Network error '${message}'. Retrying in ${backoffMs}ms (attempt ${attempt + 1}/${this.maxApiRetries})`);
                    await sleep(backoffMs);
                    continue;
                }
                throw new Error(`Kimi network error: ${message}`);
            }
            console.log(`\uD83D\uDCCA [KIMI] Response status: ${response.status} ${response.statusText}`);
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
                console.error(`\u274C [KIMI] ${normalizedMessage}`);
                throw new Error(normalizedMessage);
            }
            const isTransient = response.status >= 500 && response.status !== 501;
            if ((isRateLimit || isTransient) && attempt < this.maxApiRetries) {
                const baseDelayMs = (errorType === "engine_overloaded_error" || isTransient) ? 5000 : 2000;
                const backoffMs = baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000;
                const reason = isRateLimit ? "Rate-limited" : `Transient error (${response.status})`;
                console.warn(`\u26A0\uFE0F  [KIMI] ${reason}. Retrying in ${Math.round(backoffMs)}ms (attempt ${attempt + 1}/${this.maxApiRetries})`);
                await sleep(backoffMs);
                continue;
            }
            console.error(`\u274C [KIMI] API error: ${response.status} - ${errorText}`);
            throw new Error(`Kimi API error: ${response.status} - ${errorText}`);
        }
        throw new Error("Kimi API error: retries exhausted without response");
    }
}
exports.KimiClient = KimiClient;
