/**
 * Augment NodeJS.Process with Electron-specific properties.
 *
 * In Electron mode, `process.resourcesPath` is set by Electron itself.
 * In Web server mode, this property may not exist at runtime — callers
 * guard access via optional chaining or try/catch. This declaration
 * satisfies TypeScript when the `electron` package is not installed.
 */
declare namespace NodeJS {
  interface Process {
    resourcesPath: string;
  }
}
