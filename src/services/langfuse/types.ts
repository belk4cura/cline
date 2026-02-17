/**
 * Langfuse Service Types
 *
 * Type definitions for Langfuse v3 observability integration.
 * Maps Cura concepts to Langfuse's data model for unified cost tracking
 * across both the Deep Agent Orchestrator and the Cline desktop agent.
 */

export interface LangfuseConfig {
	secretKey: string
	publicKey: string
	baseUrl: string
	enabled: boolean
	flushAt: number
	flushInterval: number
}

export interface LangfuseTraceContext {
	/** Unique per API call (UUID) */
	traceId: string
	/** Cura thread_id from gRPC (= Langfuse session_id, matches Deep Agent) */
	sessionId: string
	/** Cognito sub from CURA_USER_ID env var */
	userId: string
	/** e.g. ["cline-desktop", providerId, modelId] */
	tags: string[]
	/** provider, mode (plan/act), taskId, etc. */
	metadata: Record<string, unknown>
}

export interface LangfuseGenerationInput {
	/** "chat-completion" or provider-specific */
	name: string
	/** Model ID from ApiHandlerModel */
	model: string
	inputTokens: number
	outputTokens: number
	cacheWriteTokens?: number
	cacheReadTokens?: number
	/** Pre-calculated by provider, if available */
	totalCost?: number
	startTime: Date
	endTime: Date
	metadata?: Record<string, unknown>
}
