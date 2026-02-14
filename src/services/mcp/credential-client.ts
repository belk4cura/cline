/**
 * Lightweight gRPC client for the CredentialService on the host bridge.
 *
 * At MCP server spawn time McpHub calls `getServerCredentials(serverName)`
 * which returns env vars stored in the OS keychain (macOS Keychain /
 * Windows Credential Manager / Linux libsecret).
 *
 * This keeps credentials out of `cline_mcp_settings.json` — the settings
 * file only contains command/args/disabled, never secrets.
 */

import * as grpc from "@grpc/grpc-js"
import * as protoLoader from "@grpc/proto-loader"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"
import { HOSTBRIDGE_PORT } from "@/standalone/hostbridge-client"

// Lazy-loaded gRPC client
let credentialClient: any | null = null

function getClient(): any {
	if (credentialClient) return credentialClient

	const address = process.env.HOST_BRIDGE_ADDRESS || `127.0.0.1:${HOSTBRIDGE_PORT}`
	Logger.log(`[CredentialClient] Connecting to host bridge at ${address}`)

	// Load the proto definition
	const protoPath = path.resolve(__dirname, "../proto/host/credential.proto")
	const packageDef = protoLoader.loadSync(protoPath, {
		keepCase: false,
		longs: String,
		enums: String,
		defaults: true,
		oneofs: true,
		includeDirs: [path.resolve(__dirname, "../proto")],
	})

	const grpcObj = grpc.loadPackageDefinition(packageDef) as any
	const CredentialServiceClient = grpcObj.host.CredentialService
	credentialClient = new CredentialServiceClient(address, grpc.credentials.createInsecure())
	return credentialClient
}

/**
 * Fetch credentials for an MCP server from the OS keychain via the host bridge.
 *
 * @param serverName  The MCP server name (e.g. "gmail", "slack")
 * @returns           Map of env var name → value, or empty map if none found
 */
export async function getServerCredentials(serverName: string): Promise<Record<string, string>> {
	return new Promise((resolve) => {
		try {
			const client = getClient()
			client.getServerCredentials({ value: serverName }, (err: any, response: any) => {
				if (err) {
					Logger.log(`[CredentialClient] Failed to fetch credentials for "${serverName}": ${err.message}`)
					resolve({})
					return
				}
				// response.env is a map<string, string>
				resolve(response?.env || {})
			})
		} catch (err: any) {
			Logger.log(`[CredentialClient] Error creating credential client: ${err.message}`)
			resolve({})
		}
	})
}

/**
 * Reset the client (e.g. if the host bridge restarts).
 */
export function resetCredentialClient(): void {
	if (credentialClient) {
		try {
			credentialClient.close()
		} catch {
			// ignore
		}
		credentialClient = null
	}
}
