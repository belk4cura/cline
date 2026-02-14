import { EmptyRequest } from "@shared/proto/cline/common"
import { ServerCredentials } from "@shared/proto/host/credential"

/**
 * VSCode host-bridge stub for storeServerCredentials.
 *
 * In standalone/Tauri mode, the Rust backend delegates credential storage
 * to the Go host-bridge via gRPC CredentialServiceClient.
 *
 * In VSCode extension mode, this stub is a no-op. Credentials would need
 * to be managed through VSCode's SecretStorage API in a future iteration.
 */
export async function storeServerCredentials(_request: ServerCredentials): Promise<EmptyRequest> {
	return EmptyRequest.create({})
}
