/** ONNX Runtime WASM threads need cross-origin isolation (SharedArrayBuffer). */
export function onnxWasmThreadCount(): number {
  if (typeof navigator === 'undefined') return 1
  const cores = navigator.hardwareConcurrency || 2
  const canUseThreads =
    typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated === true
  return canUseThreads ? Math.min(2, Math.max(1, cores - 1)) : 1
}
