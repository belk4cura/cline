/**
 * One-time migration from VSCode's ExtensionContext storage to file-backed stores.
 *
 * VSCode historically stored global state, workspace state, and secrets via the
 * ExtensionContext API (backed by SQLite under ~/.vscode/). This module migrates
 * that data to the shared file-backed stores in ~/.cline/data/ so all platforms
 * (VSCode, CLI, JetBrains) share the same persistence layer.
 *
 * ## Migration semantics
 *
 * - The migration writes a sentinel key (`__migrationVersion`) into the file-backed
 *   globalState. If that key already exists with a version >= CURRENT_MIGRATION_VERSION,
 *   the migration is skipped entirely.
 *
 * - **Merge strategy: file-backed store wins.** If a key already exists in the
 *   file store (e.g. because CLI or JetBrains wrote it), we do NOT overwrite.
 *   This prevents the migration from clobbering newer data written by another client.
 *
 * - VSCode storage is NOT cleared after migration. This ensures safe downgrade:
 *   if the user rolls back to an older extension version that doesn't know about
 *   file-backed stores, the old code path still works.
 *
 * - taskHistory is NOT migrated here — it already has its own file-based storage
 *   at ~/.cline/data/tasks/taskHistory.json that all platforms share.
 */

import type * as vscode from "vscode"
import { Logger } from "@/shared/services/Logger"
import { GlobalStateAndSettingKeys, LocalStateKeys, SecretKeys } from "@/shared/storage/state-keys"
import type { StorageContext } from "@/shared/storage/storage-context"

/** Bump this when adding new migration steps. */
const CURRENT_MIGRATION_VERSION = 1

/** Sentinel key written to the file-backed globalState to track migration. */
const MIGRATION_VERSION_KEY = "__migrationVersion"

export interface MigrationResult {
	migrated: boolean
	globalStateCount: number
	secretsCount: number
	workspaceStateCount: number
	skippedExisting: number
}

/**
 * Run the one-time migration from VSCode ExtensionContext storage to file-backed stores.
 *
 * Safe to call on every startup — it checks the sentinel and returns immediately
 * if migration has already been completed at the current version.
 *
 * @param vscodeContext The VSCode ExtensionContext (source of truth for legacy data)
 * @param storage The file-backed StorageContext (destination)
 * @returns Summary of what was migrated
 */
export async function migrateVSCodeStorageToFiles(
	vscodeContext: vscode.ExtensionContext,
	storage: StorageContext,
): Promise<MigrationResult> {
	const result: MigrationResult = {
		migrated: false,
		globalStateCount: 0,
		secretsCount: 0,
		workspaceStateCount: 0,
		skippedExisting: 0,
	}

	// Check sentinel — skip if already migrated at this version or higher
	const existingVersion = storage.globalState.get<number>(MIGRATION_VERSION_KEY)
	if (existingVersion !== undefined && existingVersion >= CURRENT_MIGRATION_VERSION) {
		Logger.info(`[Migration] File-backed stores already at version ${existingVersion}, skipping migration.`)
		return result
	}

	Logger.info(
		`[Migration] Starting VSCode → file-backed migration (current sentinel: ${existingVersion ?? "none"}, target: ${CURRENT_MIGRATION_VERSION})`,
	)

	try {
		// ─── 1. Migrate global state ───────────────────────────────────
		for (const key of GlobalStateAndSettingKeys) {
			// Read from VSCode's globalState
			const vscodeValue = vscodeContext.globalState.get(key)
			if (vscodeValue === undefined) {
				continue
			}

			// Only write if the file store doesn't already have a value
			const existingFileValue = storage.globalState.get(key)
			if (existingFileValue !== undefined) {
				result.skippedExisting++
				continue
			}

			storage.globalState.set(key, vscodeValue)
			result.globalStateCount++
		}

		// ─── 2. Migrate secrets ────────────────────────────────────────
		for (const key of SecretKeys) {
			try {
				// Read from VSCode's secret storage
				const vscodeValue = await vscodeContext.secrets.get(key)
				if (vscodeValue === undefined || vscodeValue === "") {
					continue
				}

				// Only write if the file store doesn't already have a value
				const existingFileValue = storage.secrets.get(key)
				if (existingFileValue !== undefined && existingFileValue !== "") {
					result.skippedExisting++
					continue
				}

				storage.secrets.set(key, vscodeValue)
				result.secretsCount++
			} catch (error) {
				// Individual secret read failure shouldn't block the whole migration
				Logger.error(`[Migration] Failed to read secret '${key}' from VSCode:`, error)
			}
		}

		// ─── 3. Migrate workspace state ────────────────────────────────
		for (const key of LocalStateKeys) {
			const vscodeValue = vscodeContext.workspaceState.get(key)
			if (vscodeValue === undefined) {
				continue
			}

			// Only write if the file store doesn't already have a value
			const existingFileValue = storage.workspaceState.get(key)
			if (existingFileValue !== undefined) {
				result.skippedExisting++
				continue
			}

			storage.workspaceState.set(key, vscodeValue)
			result.workspaceStateCount++
		}

		// ─── 4. Write sentinel ─────────────────────────────────────────
		storage.globalState.set(MIGRATION_VERSION_KEY, CURRENT_MIGRATION_VERSION)
		result.migrated = true

		Logger.info(
			`[Migration] Complete: ${result.globalStateCount} global state keys, ` +
				`${result.secretsCount} secrets, ${result.workspaceStateCount} workspace state keys migrated. ` +
				`${result.skippedExisting} keys skipped (already in file store).`,
		)
	} catch (error) {
		Logger.error("[Migration] Fatal error during VSCode → file-backed migration:", error)
		// Don't write sentinel on failure — migration will retry next startup
		throw error
	}

	return result
}
