/**
 * Mock types for SDK messages and hooks to remove dependency on @anthropic-ai/claude-agent-sdk
 */

export type SDKMessage = 
  | { type: "assistant"; message: any }
  | { type: "stream_event"; event: any }
  | { type: "result"; is_error: boolean; stop_reason?: string; subtype?: string; errors?: string[]; result?: string; usage?: any }
  | { type: "tool_use"; tool_name: string; tool_input: any; tool_use_id: string }
  | { type: "tool_result"; tool_name: string; tool_output: any; tool_use_id: string }
  | { type: "error"; error: any };

export type HookCallback = (input: any) => Promise<{ continue: boolean; decision?: string; reason?: string } | any>;
