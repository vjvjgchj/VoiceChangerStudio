class LocalRealtimeVoiceProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.blockSize = 128;
        this.recording = false;
        this.volume = 0;
        this.playBuffer = [];
        this.pendingOutput = new Float32Array(0);
        this.port.onmessage = (event) => this.handleMessage(event.data);
    }

    handleMessage(request) {
        if (!request || !request.requestType) {
            return;
        }

        if (request.requestType === "start") {
            this.recording = true;
            this.port.postMessage({ responseType: "start_ok" });
            return;
        }

        if (request.requestType === "stop") {
            this.recording = false;
            this.playBuffer = [];
            this.pendingOutput = new Float32Array(0);
            this.port.postMessage({ responseType: "stop_ok" });
            return;
        }

        if (request.requestType === "truncateBuffer") {
            this.truncateBuffer();
            return;
        }

        if (request.requestType === "voice" && request.voice) {
            this.pushVoice(request.voice);
        }
    }

    pushVoice(floatData) {
        const merged = new Float32Array(this.pendingOutput.length + floatData.length);
        merged.set(this.pendingOutput, 0);
        merged.set(floatData, this.pendingOutput.length);

        const blockCount = Math.floor(merged.length / this.blockSize);
        for (let index = 0; index < blockCount; index += 1) {
            this.playBuffer.push(merged.slice(index * this.blockSize, (index + 1) * this.blockSize));
        }
        this.pendingOutput = merged.slice(blockCount * this.blockSize);

        const maxBlocks = Math.max(6, Math.ceil((floatData.length / this.blockSize) * 1.5));
        if (this.playBuffer.length > maxBlocks) {
            this.truncateBuffer();
        }
        this.port.postMessage({ responseType: "buffer", blocks: this.playBuffer.length });
    }

    truncateBuffer() {
        while (this.playBuffer.length > 2) {
            this.playBuffer.shift();
        }
        this.port.postMessage({ responseType: "buffer", blocks: this.playBuffer.length });
    }

    calculateVolume(block) {
        let sum = 0;
        for (let index = 0; index < block.length; index += 1) {
            sum += block[index] * block[index];
        }
        const rms = Math.sqrt(sum / block.length);
        this.volume = Math.max(rms, this.volume * 0.95);
        return this.volume;
    }

    process(inputs, outputs) {
        if (this.recording && inputs.length > 0 && inputs[0].length > 0) {
            this.port.postMessage({
                responseType: "inputData",
                inputData: inputs[0][0],
            });
        }

        if (!outputs.length || !outputs[0].length) {
            return true;
        }

        const output = outputs[0][0];
        const block = this.playBuffer.shift();
        if (!block) {
            output.fill(0);
            return true;
        }

        output.set(block);
        for (let channel = 1; channel < outputs[0].length; channel += 1) {
            outputs[0][channel].set(block);
        }
        this.port.postMessage({
            responseType: "volume",
            volume: this.calculateVolume(block),
            blocks: this.playBuffer.length,
        });
        return true;
    }
}

registerProcessor("local-realtime-voice-processor", LocalRealtimeVoiceProcessor);
