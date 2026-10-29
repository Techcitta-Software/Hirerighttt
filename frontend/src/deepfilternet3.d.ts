declare module 'deepfilternet3-noise-filter' {
  export interface DeepFilterNet3Options {
    sampleRate?: number
    noiseReductionLevel?: number
    assetConfig?: { cdnUrl?: string }
  }

  export class DeepFilterNet3Core {
    constructor(options?: DeepFilterNet3Options)
    initialize(): Promise<void>
    createAudioWorkletNode(audioContext: AudioContext): Promise<AudioNode>
    setSuppressionLevel(level: number): void
    destroy(): void
  }
}

