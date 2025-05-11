import { logger } from "../../config";
import {
  ElevenLabsVoiceEnum,
  type ElevenLabsVoices,
} from "../../types/elevenlabs";

const BASE_URL = "https://api.elevenlabs.io/v1";
const MP3_FORMAT = "mp3_44100_128";

export class ElevenLabs {
  constructor(private apiKey: string) {}

  async generate(
    text: string,
    voiceId: ElevenLabsVoices = ElevenLabsVoiceEnum.finn,
  ): Promise<{
    audio: ArrayBuffer;
    audioLength: number;
  }> {
    try {
      const response = await fetch(
        `${BASE_URL}/text-to-speech/${voiceId}/stream?output_format=${MP3_FORMAT}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": this.apiKey,
          },
          body: JSON.stringify({
            text,
            model_id: "eleven_multilingual_v2",
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`ElevenLabs API error: ${response.statusText}`);
      }

      const audioBuffer = await response.arrayBuffer();
      const audioContext = new AudioContext();
      const audioData = await audioContext.decodeAudioData(audioBuffer);

      logger.debug(
        { text, voiceId, audioLength: audioData.duration },
        "Audio generated with ElevenLabs",
      );

      return {
        audio: audioBuffer,
        audioLength: audioData.duration,
      };
    } catch (error) {
      logger.error(
        { error, text, voiceId },
        "Failed to generate audio with ElevenLabs",
      );
      throw error;
    }
  }

  static async concatWavBuffers(buffers: ArrayBuffer[]): Promise<ArrayBuffer> {
    if (buffers.length === 0) return new ArrayBuffer(0);
    if (buffers.length === 1) return buffers[0];

    const audioContext = new AudioContext();
    const audioBuffers = await Promise.all(
      buffers.map((buffer) => audioContext.decodeAudioData(buffer)),
    );

    const totalLength = audioBuffers.reduce(
      (acc, buffer) => acc + buffer.length,
      0,
    );
    const sampleRate = audioBuffers[0].sampleRate;
    const numberOfChannels = audioBuffers[0].numberOfChannels;

    const result = audioContext.createBuffer(
      numberOfChannels,
      totalLength,
      sampleRate,
    );

    let offset = 0;
    for (const buffer of audioBuffers) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        const channelData = result.getChannelData(channel);
        channelData.set(buffer.getChannelData(channel), offset);
      }
      offset += buffer.length;
    }

    // Convert AudioBuffer to ArrayBuffer in WAV format
    const wavEncoder = new WavEncoder(result);
    return wavEncoder.encode();
  }

  static async init(apiKey: string): Promise<ElevenLabs> {
    if (!apiKey) {
      throw new Error("ElevenLabs API key is required");
    }
    return new ElevenLabs(apiKey);
  }

  listAvailableVoices(): ElevenLabsVoices[] {
    return Object.values(ElevenLabsVoiceEnum) as ElevenLabsVoices[];
  }
}

// Simple WAV encoder class
class WavEncoder {
  constructor(private audioBuffer: AudioBuffer) {}

  encode(): ArrayBuffer {
    const numOfChan = this.audioBuffer.numberOfChannels;
    const length = this.audioBuffer.length * numOfChan * 2;
    const buffer = new ArrayBuffer(44 + length);
    const view = new DataView(buffer);
    const sampleRate = this.audioBuffer.sampleRate;

    // Write WAV header
    this.writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + length, true);
    this.writeString(view, 8, "WAVE");
    this.writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numOfChan, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2 * numOfChan, true);
    view.setUint16(32, numOfChan * 2, true);
    view.setUint16(34, 16, true);
    this.writeString(view, 36, "data");
    view.setUint32(40, length, true);

    // Write audio data
    const offset = 44;
    for (let i = 0; i < this.audioBuffer.length; i++) {
      for (let channel = 0; channel < numOfChan; channel++) {
        const sample = this.audioBuffer.getChannelData(channel)[i];
        const int16Sample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        view.setInt16(
          offset + (i * numOfChan + channel) * 2,
          int16Sample,
          true,
        );
      }
    }

    return buffer;
  }

  private writeString(view: DataView, offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }
}
