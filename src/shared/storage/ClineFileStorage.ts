import * as fs from "node:fs"
import * as path from "node:path"
import { Logger } from "../services/Logger"
import { ClineSyncStorage } from "./ClineStorage"

export interface ClineFileStorageOptions {
	/**
	 * File permissions mode (e.g., 0o600 for owner read/write only).
	 * If not set, uses the system default.
	 */
	fileMode?: number
}

/**
 * Synchronous file-backed JSON storage.
 * Stores any JSON-serializable values with sync read and write.
 * Used for VSCode Memento compatibility and CLI environments.
 */
export class ClineFileStorage<T = any> extends ClineSyncStorage<T> {
	protected name: string
	private data: Record<string, T>
	private readonly fsPath: string
	private readonly fileMode?: number

	constructor(filePath: string, name = "ClineFileStorage", options?: ClineFileStorageOptions) {
		super()
		this.fsPath = filePath
		this.name = name
		this.fileMode = options?.fileMode
		this.data = this.readFromDisk()
	}

	protected _get(key: string): T | undefined {
		return this.data[key]
	}

	protected _set(key: string, value: T | undefined): void {
		if (value === undefined) {
			delete this.data[key]
		} else {
			this.data[key] = value
		}
		this.writeToDisk()
	}

	protected _delete(key: string): void {
		delete this.data[key]
		this.writeToDisk()
	}

	/**
	 * Set multiple keys in a single write operation.
	 * More efficient than calling set() for each key individually,
	 * since it only writes to disk once.
	 */
	public setBatch(entries: Record<string, T | undefined>): void {
		let changed = false
		for (const [key, value] of Object.entries(entries)) {
			if (value === undefined) {
				if (key in this.data) {
					delete this.data[key]
					changed = true
				}
			} else {
				this.data[key] = value
				changed = true
			}
		}
		if (changed) {
			this.writeToDisk()
			// Fire change events for each key
			for (const key of Object.keys(entries)) {
				this.fire(key)
			}
		}
	}

	protected _keys(): readonly string[] {
		return Object.keys(this.data)
	}

	private readFromDisk(): Record<string, T> {
		try {
			if (fs.existsSync(this.fsPath)) {
				return JSON.parse(fs.readFileSync(this.fsPath, "utf-8"))
			}
		} catch (error) {
			Logger.error(`[${this.name}] failed to read from ${this.fsPath}:`, error)
		}
		return {}
	}

	private writeToDisk(): void {
		try {
			const dir = path.dirname(this.fsPath)
			fs.mkdirSync(dir, { recursive: true })
			const options: fs.WriteFileOptions = this.fileMode ? { encoding: "utf-8", mode: this.fileMode } : "utf-8"
			fs.writeFileSync(this.fsPath, JSON.stringify(this.data, null, 2), options)
		} catch (error) {
			Logger.error(`[${this.name}] failed to write to ${this.fsPath}:`, error)
		}
	}
}
