/**
 * LangfuseService — Singleton for Langfuse v3 LLM cost observability
 *
 * Manages the Langfuse SDK client lifecycle and provides non-throwing methods
 * for tracing LLM API calls. All public methods catch errors internally and
 * log at debug level — Langfuse failures never affect the user's AI workflow.
 *
 * Data model mapping (unified with Deep Agent Orchestrator):
 *   - Cognito user_id → Langfuse user_id
 *   - Cura thread_id  → Langfuse session_id (via gRPC passthrough)
 *   - Per-API-call     → Langfuse trace + generation
 *   - Surface tag      → ["cline-desktop", ...]
 */

import { Logger } from "@shared/services/Logger"
import type { LangfuseGenerationInput, LangfuseTraceContext } from "./types"

// Use `any` for Langfuse SDK types to avoid build-time dependency issues
// when the langfuse package hasn't been installed yet. At runtime, we
// dynamically import the SDK only if configured.
type LangfuseClient = any
type LangfuseTraceHandle = any

export class LangfuseService {
	private static _instance: LangfuseService | null = null

	private client: LangfuseClient | null = null
	private enabled = false

	/** Current Cura thread_id (= Langfuse session_id) — set per task via gRPC */
	private currentSessionId: string | null = null
	/** Current Cognito user sub — set from CURA_USER_ID env var */
	private currentUserId: string | null = null

	private constructor() {}

	static getInstance(): LangfuseService {
		if (!LangfuseService._instance) {
			LangfuseService._instance = new LangfuseService()
		}
		return LangfuseService._instance
	}

	/**
	 * Initialize the Langfuse client from environment variables.
	 * Call once at extension/sidecar startup.
	 *
	 * Required env vars:
	 *   LANGFUSE_SECRET_KEY — sk-lf-...
	 *   LANGFUSE_PUBLIC_KEY — pk-lf-...
	 *   LANGFUSE_BASE_URL  — https://us.cloud.langfuse.com (optional, defaults)
	 *   CURA_USER_ID       — Cognito sub for per-user cost attribution
	 */
	initialize(): void {
		try {
			const secretKey = process.env.LANGFUSE_SECRET_KEY
			const publicKey = process.env.LANGFUSE_PUBLIC_KEY
			const baseUrl = process.env.LANGFUSE_BASE_URL || "https://us.cloud.langfuse.com"

			if (!secretKey || !publicKey) {
				Logger.log("[LangfuseService] Keys not set — observability disabled")
				this.enabled = false
				return
			}

			// Store default user ID from env
			this.currentUserId = process.env.CURA_USER_ID || null

			// Dynamic import to avoid bundling langfuse when not installed
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const { Langfuse } = require("langfuse")

			this.client = new Langfuse({
				secretKey,
				publicKey,
				baseUrl,
				flushAt: 15,
				flushInterval: 10000,
			})

			this.enabled = true
			Logger.log(`[LangfuseService] ✅ Initialized (host=${baseUrl})`)
		} catch (error) {
			Logger.log(`[LangfuseService] Failed to initialize (non-critical): ${error}`)
			this.enabled = false
		}
	}

	/**
	 * Set the current task session context for subsequent traces.
	 *
	 * @param threadId — Cura thread_id received via gRPC (NOT Cline's internal taskId)
	 * @param userId  — Cognito sub (optional, falls back to CURA_USER_ID env var)
	 */
	setSession(threadId: string, userId?: string): void {
		this.currentSessionId = threadId
		if (userId) {
			this.currentUserId = userId
		}
	}

	/** Get the current session ID (thread_id) */
	getSessionId(): string | null {
		return this.currentSessionId
	}

	/** Get the current user ID */
	getUserId(): string | null {
		return this.currentUserId
	}

	/** Check if Langfuse is enabled and initialized */
	isEnabled(): boolean {
		return this.enabled && this.client !== null
	}

	/**
	 * Create a new Langfuse trace for an API call.
	 *
	 * @returns Trace handle to attach generations to, or null if disabled.
	 */
	createTrace(context: LangfuseTraceContext): LangfuseTraceHandle | null {
		if (!this.enabled || !this.client) {
			return null
		}

		try {
			const trace = this.client.trace({
				id: context.traceId,
				sessionId: context.sessionId,
				userId: context.userId,
				name: `cline:${context.metadata?.taskId || "unknown"}`,
				tags: context.tags,
				metadata: context.metadata,
			})
			return trace
		} catch (error) {
			Logger.log(`[LangfuseService] Failed to create trace (non-critical): ${error}`)
			return null
		}
	}

	/**
	 * Log an LLM generation observation on an existing trace.
	 * Now includes input/output content for Langfuse dashboard visibility.
	 */
	logGeneration(trace: LangfuseTraceHandle, input: LangfuseGenerationInput): void {
		if (!trace) {
			return
		}

		try {
			trace.generation({
				name: input.name,
				model: input.model,
				startTime: input.startTime,
				endTime: input.endTime,
				input: input.input,
				output: input.output,
				usage: {
					input: input.inputTokens,
					output: input.outputTokens,
					unit: "TOKENS",
				},
				metadata: {
					cacheWriteTokens: input.cacheWriteTokens,
					cacheReadTokens: input.cacheReadTokens,
					totalCost: input.totalCost,
					...input.metadata,
				},
			})
		} catch (error) {
			Logger.log(`[LangfuseService] Failed to log generation (non-critical): ${error}`)
		}
	}

	/**
	 * Log a tool execution span on the most recent trace.
	 * Called when Cline executes a tool (file op, command, MCP tool, etc.)
	 *
	 * @param toolName — e.g. "write_to_file", "execute_command", "use_mcp_tool"
	 * @param input — Tool input (path, command, etc.)
	 * @param output — Tool result (success/error, preview)
	 * @param startTime — When tool execution started
	 * @param endTime — When tool execution completed
	 */
	logToolSpan(
		trace: LangfuseTraceHandle,
		toolName: string,
		input: Record<string, unknown>,
		output: Record<string, unknown>,
		startTime?: Date,
		endTime?: Date,
	): void {
		if (!trace) {
			return
		}

		try {
			trace.span({
				name: `tool:${toolName}`,
				startTime: startTime || new Date(),
				endTime: endTime || new Date(),
				input,
				output,
				metadata: {
					surface: "cline-desktop",
				},
			})
		} catch (error) {
			Logger.log(`[LangfuseService] Failed to log tool span (non-critical): ${error}`)
		}
	}

	/**
	 * Flush pending events to Langfuse Cloud.
	 * Call on task completion and extension deactivation.
	 */
	async flush(): Promise<void> {
		if (!this.client) {
			return
		}

		try {
			await this.client.flushAsync()
		} catch (error) {
			Logger.log(`[LangfuseService] Failed to flush (non-critical): ${error}`)
		}
	}

	/**
	 * Flush + close the Langfuse client.
	 * Call on extension deactivation / sidecar shutdown.
	 */
	async shutdown(): Promise<void> {
		if (!this.client) {
			return
		}

		try {
			await this.client.shutdownAsync()
			Logger.log("[LangfuseService] Client shut down")
		} catch (error) {
			Logger.log(`[LangfuseService] Failed to shutdown (non-critical): ${error}`)
		}

		this.client = null
		this.enabled = false
	}
}
