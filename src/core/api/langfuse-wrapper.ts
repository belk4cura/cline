/**
 * Langfuse API Handler Wrapper
 *
 * Wraps an ApiHandler's createMessage() with Langfuse tracing.
 * Intercepts the ApiStream to capture usage chunks and report them
 * as Langfuse generation observations. Completely transparent — if
 * Langfuse is disabled, returns the handler unchanged.
 *
 * Now captures input (system prompt + messages) and output (assistant
 * response text) for full visibility in the Langfuse dashboard.
 */

import { LangfuseService } from "@services/langfuse"
import { randomUUID } from "crypto"
import type { ApiHandler, ApiHandlerModel } from "./index"
import type { ApiStream } from "./transform/stream"

/**
 * Wrap an ApiHandler with Langfuse tracing.
 *
 * The wrapper:
 * - Delegates getModel() and abort() directly to the original handler
 * - Wraps createMessage() in an async generator that:
 *   1. Records start time
 *   2. Creates a Langfuse trace with session/user context
 *   3. Passes through all ApiStream chunks unchanged
 *   4. Captures "usage" chunks for token counts
 *   5. Captures "text" chunks for output content
 *   6. Logs a generation observation with input/output after stream completes
 *
 * @param handler - The original ApiHandler from buildApiHandler()
 * @param providerInfo - Provider metadata (providerId, model, mode)
 * @returns Wrapped handler, or original if Langfuse is disabled
 */
export function wrapWithLangfuse(
	handler: ApiHandler,
	providerInfo: { providerId: string; model: string; mode: string },
): ApiHandler {
	const langfuse = LangfuseService.getInstance()

	if (!langfuse.isEnabled()) {
		return handler
	}

	return {
		getModel(): ApiHandlerModel {
			return handler.getModel()
		},

		abort: handler.abort?.bind(handler),

		getApiStreamUsage: handler.getApiStreamUsage?.bind(handler),

		createMessage(...args: Parameters<ApiHandler["createMessage"]>): ApiStream {
			const originalStream = handler.createMessage(...args)
			return wrapStream(originalStream, handler, providerInfo, langfuse, args)
		},
	}
}

async function* wrapStream(
	stream: ApiStream,
	handler: ApiHandler,
	providerInfo: { providerId: string; model: string; mode: string },
	langfuse: LangfuseService,
	args: Parameters<ApiHandler["createMessage"]>,
): ApiStream {
	const startTime = new Date()
	const traceId = randomUUID()

	const sessionId = langfuse.getSessionId() || "standalone"
	const userId = langfuse.getUserId() || "unknown"
	const { id: modelId } = handler.getModel()

	// Capture input: system prompt (truncated) + message count
	const [systemPrompt, messages] = args
	const inputSummary = {
		systemPrompt: systemPrompt ? systemPrompt.substring(0, 500) + (systemPrompt.length > 500 ? "..." : "") : "",
		messageCount: messages?.length || 0,
		lastUserMessage: (() => {
			if (!messages || messages.length === 0) return ""
			const lastMsg = messages[messages.length - 1]
			if (typeof lastMsg === "object" && lastMsg !== null) {
				const content = (lastMsg as any).content || (lastMsg as any).text || ""
				if (typeof content === "string") {
					return content.substring(0, 1000) + (content.length > 1000 ? "..." : "")
				}
			}
			return ""
		})(),
	}

	const trace = langfuse.createTrace({
		traceId,
		sessionId,
		userId,
		tags: ["cline-desktop", providerInfo.providerId, modelId],
		metadata: {
			provider: providerInfo.providerId,
			model: modelId,
			mode: providerInfo.mode,
		},
	})

	// Set input on the trace
	if (trace) {
		try {
			trace.update({
				input: inputSummary,
			})
		} catch {
			// Non-critical
		}
	}

	// Accumulate usage from stream chunks
	let inputTokens = 0
	let outputTokens = 0
	let cacheWriteTokens = 0
	let cacheReadTokens = 0
	let totalCost: number | undefined

	// Accumulate output text from stream
	let outputText = ""

	try {
		for await (const chunk of stream) {
			// Passthrough all chunks unchanged
			yield chunk

			// Capture usage data
			if (chunk.type === "usage") {
				inputTokens += chunk.inputTokens
				outputTokens += chunk.outputTokens
				cacheWriteTokens += chunk.cacheWriteTokens ?? 0
				cacheReadTokens += chunk.cacheReadTokens ?? 0
				totalCost = chunk.totalCost ?? totalCost
			}

			// Capture output text
			if (chunk.type === "text") {
				outputText += chunk.text
			}
		}
	} finally {
		// Log generation after stream completes (success or error)
		const endTime = new Date()

		// Truncate output for Langfuse (avoid massive payloads)
		const truncatedOutput =
			outputText.length > 5000
				? outputText.substring(0, 5000) + `... [truncated, total ${outputText.length} chars]`
				: outputText

		// Update trace with output
		if (trace && truncatedOutput) {
			try {
				trace.update({
					output: truncatedOutput,
				})
			} catch {
				// Non-critical
			}
		}

		if (trace && (inputTokens > 0 || outputTokens > 0)) {
			langfuse.logGeneration(trace, {
				name: "chat-completion",
				model: modelId,
				inputTokens,
				outputTokens,
				cacheWriteTokens: cacheWriteTokens || undefined,
				cacheReadTokens: cacheReadTokens || undefined,
				totalCost,
				startTime,
				endTime,
				input: inputSummary,
				output: truncatedOutput || undefined,
				metadata: {
					provider: providerInfo.providerId,
					mode: providerInfo.mode,
				},
			})
		}
	}
}
