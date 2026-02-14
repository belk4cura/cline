import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"

/**
 * VSCode host-bridge stub for deleteServerCredentials.
 *
 * In standalone/Tauri mode, the Rust backend delegates credential deletion
 * to the Go host-bridge via gRPC CredentialServiceClient.
 *
 * In VSCode extension mode, this stub is a no-op. Credentials would need
 * to be managed through VSCode's SecretStorage API in a future iteration.
 */
export async function deleteServerCredentials(_request: StringRequest): Promise<EmptyRequest> {
	return EmptyRequest.create({})
}
