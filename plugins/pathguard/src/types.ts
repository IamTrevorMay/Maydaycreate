/** A media file tracked by PathGuard */
export interface TrackedFile {
  /** Partial hash: first 64KB + last 64KB + file size */
  hash: string;
  /** Actual file path on disk */
  realPath: string;
  /** Managed symlink path */
  symlinkPath: string;
  /** Premiere project file path */
  projectPath: string;
  /** Premiere ProjectItem.nodeId */
  nodeId: string;
  /** File size in bytes */
  fileSize: number;
  /** ISO timestamp of last verification */
  lastSeen: string;
  /** ISO timestamp of initial tracking */
  createdAt: string;
}

/** Result from scanning the Premiere project tree */
export interface ScanResult {
  /** Newly discovered items not yet tracked */
  newItems: ProjectItemInfo[];
  /** Total items in the project */
  totalItems: number;
  /** Items already managed by PathGuard */
  managedItems: number;
}

/** Info about a Premiere ProjectItem returned from ExtendScript */
export interface ProjectItemInfo {
  /** ProjectItem.nodeId — stable within a project session */
  nodeId: string;
  /** Display name in the project panel */
  name: string;
  /** Absolute file path of the media */
  filePath: string;
  /** Media type (video, audio, image, etc.) */
  mediaType: string;
}

/** PathGuard status for display in the panel */
export interface PathGuardStatus {
  /** Whether the plugin is actively scanning */
  scanning: boolean;
  /** Current project path */
  projectPath: string | null;
  /** Number of files being managed */
  managedCount: number;
  /** Number of symlinks with broken targets */
  brokenCount: number;
  /** Whether the daemon process is running */
  daemonRunning: boolean;
  /** Last scan timestamp */
  lastScan: string | null;
}

/** Symlink reconciliation result */
export interface ReconcileResult {
  /** Total symlinks checked */
  checked: number;
  /** Symlinks that were valid */
  valid: number;
  /** Symlinks repaired from DB state */
  repaired: number;
  /** Symlinks that could not be repaired (real file missing) */
  broken: number;
  /** Details of broken symlinks */
  brokenFiles: Array<{ symlinkPath: string; expectedTarget: string }>;
}
