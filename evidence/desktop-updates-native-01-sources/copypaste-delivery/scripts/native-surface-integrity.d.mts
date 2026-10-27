export interface NativeSurfaceOptions {
  desktop: string;
  extension: string;
  executable: string;
  packaged: boolean;
}
export interface NativeSurfaceSnapshot {
  schema_version: number;
  desktop: Record<string, unknown>;
  extension: Record<string, unknown>;
  verifier_sha256: string;
  integrity_checker_sha256: string;
}
export function sha256(file: string | URL): Promise<string>;
export function directoryFiles(
  root: string,
  relative?: string,
): Promise<string[]>;
export function captureNativeSurfaces(
  options: NativeSurfaceOptions,
): Promise<NativeSurfaceSnapshot>;
export function assertTestedSurfaces(
  report: unknown,
  current: NativeSurfaceSnapshot,
): void;
