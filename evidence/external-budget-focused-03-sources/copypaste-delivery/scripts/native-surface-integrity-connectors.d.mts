import type { NativeSurfaceOptions, NativeSurfaceSnapshot } from "./native-surface-integrity.mjs";
export function sha256(file: string | URL): Promise<string>;
export function directoryFiles(root: string, relative?: string): Promise<string[]>;
export function captureNativeSurfaces(options: NativeSurfaceOptions): Promise<NativeSurfaceSnapshot>;
