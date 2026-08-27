/**
 * Ambient declarations for the browser externals. The host client runtime
 * supplies react, react/jsx-runtime and the snapshot-store module at load
 * time; these keep `tsc --noEmit -p tsconfig.client.json` honest without
 * pulling @types/react into this dependency-free package.
 */
declare module 'react' {
  export function useState<S>(initial: S | (() => S)): [S, (next: S | ((prev: S) => S)) => void]
}

declare module 'react/jsx-runtime' {
  export function jsx(type: unknown, props: Record<string, unknown>, key?: unknown): unknown
  export function jsxs(type: unknown, props: Record<string, unknown>, key?: unknown): unknown
  export namespace JSX {
    interface Element { [k: string]: unknown }
    interface IntrinsicElements { [tag: string]: Record<string, any> }
  }
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  export function createSnapshotStore<T>(initial: T): { get(): T; set(value: T): void }
}
