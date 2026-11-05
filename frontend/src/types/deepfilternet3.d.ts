declare module 'deepfilternet3-noise-filter' {
  export class DeepFilterNet3Core {
    constructor(options?: Record<string, unknown>)
    initialize(options?: Record<string, unknown>): Promise<void>
    createAudioWorkletNode(context: AudioContext): Promise<AudioNode>
    setSuppressionLevel(level: number): void
    destroy(): void
  }
}
