import { StringRequest } from "@shared/proto/cline/common"
import { ServerCredentials } from "@shared/proto/host/credential"

/**
 * VSCode host-bridge stub for getServerCredentials.
 *
 * In standalone/Tauri mode, McpHub calls the Go host-bridge directly via
 * the CredentialServiceClient (see credential-client.ts / host-bridge-clients.ts).
 *
 * In VSCode extension mode, this stub is registered as the handler.
 * Since VSCode extensions don't have access to the OS keychain via our
 * Go host-bridge, we return empty credentials. Credentials would need
 * to be managed through VSCode's SecretStorage API in a future iteration.
 */
export async function getServerCredentials(request: StringRequest): Promise<ServerCredentials> {
	return ServerCredentials.create({ serverName: request.value, env: {} })
}
