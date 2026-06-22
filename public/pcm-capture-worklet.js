// AudioWorklet that buffers mono Float32 mic frames (at the context's 16 kHz)
// and posts ~2048-sample chunks to the main thread for PCM16 encoding → Gemini Live.
class PCMCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(2048);
    this._n = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch = input[0];
    for (let i = 0; i < ch.length; i++) {
      this._buf[this._n++] = ch[i];
      if (this._n >= this._buf.length) {
        this.port.postMessage(this._buf.slice(0, this._n));
        this._n = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PCMCapture);
