class LocalSocketIOClient {
    constructor(options = {}) {
        this.namespace = options.namespace || "/test";
        this.handlers = new Map();
        this.pendingBinaryPacket = null;
        this.ws = null;
        this.connected = false;
        this.connectPromise = null;
        this.connectResolve = null;
        this.connectReject = null;
        this.connectTimer = null;
        this.pingInterval = 25000;
        this.pingTimeout = 20000;
    }

    on(eventName, handler) {
        if (!this.handlers.has(eventName)) {
            this.handlers.set(eventName, new Set());
        }
        this.handlers.get(eventName).add(handler);
        return () => this.off(eventName, handler);
    }

    off(eventName, handler) {
        this.handlers.get(eventName)?.delete(handler);
    }

    emitLocal(eventName, payload) {
        this.handlers.get(eventName)?.forEach((handler) => handler(payload));
    }

    buildUrl() {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        return `${protocol}//${window.location.host}/socket.io/?EIO=4&transport=websocket`;
    }

    connect() {
        if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
            return Promise.resolve();
        }
        if (this.connectPromise) {
            return this.connectPromise;
        }

        this.connectPromise = new Promise((resolve, reject) => {
            this.connectResolve = resolve;
            this.connectReject = reject;
            this.connectTimer = window.setTimeout(() => {
                reject(new Error("Socket.IO 连接超时"));
                this.close();
            }, 8000);

            this.ws = new WebSocket(this.buildUrl());
            this.ws.binaryType = "arraybuffer";
            this.ws.onopen = () => {
                this.emitLocal("transport_open");
            };
            this.ws.onmessage = (event) => this.handleMessage(event.data);
            this.ws.onerror = () => {
                this.emitLocal("error", new Error("Socket.IO 连接错误"));
            };
            this.ws.onclose = () => {
                const wasConnected = this.connected;
                const rejectBeforeConnect = !wasConnected && this.connectReject;
                this.connected = false;
                this.connectPromise = null;
                this.pendingBinaryPacket = null;
                if (this.connectTimer) {
                    window.clearTimeout(this.connectTimer);
                    this.connectTimer = null;
                }
                if (rejectBeforeConnect) {
                    rejectBeforeConnect(new Error("Socket.IO 连接已关闭"));
                }
                if (wasConnected) {
                    this.emitLocal("disconnect");
                }
            };
        });

        return this.connectPromise;
    }

    close() {
        if (this.connectTimer) {
            window.clearTimeout(this.connectTimer);
            this.connectTimer = null;
        }
        this.connected = false;
        this.connectPromise = null;
        this.pendingBinaryPacket = null;
        if (this.ws && this.ws.readyState <= WebSocket.OPEN) {
            this.ws.close();
        }
        this.ws = null;
    }

    sendRequest(timestamp, arrayBuffer) {
        if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) {
            throw new Error("Socket.IO 尚未连接");
        }
        const payload = `451-${this.namespace},["request_message",[${timestamp},{"_placeholder":true,"num":0}]]`;
        this.ws.send(payload);
        this.ws.send(arrayBuffer);
    }

    handleMessage(data) {
        if (typeof data !== "string") {
            this.handleBinary(data);
            return;
        }

        if (data === "2") {
            this.ws?.send("3");
            return;
        }

        const enginePacketType = data.charAt(0);
        if (enginePacketType === "0") {
            this.handleOpenPacket(data.slice(1));
            return;
        }

        if (enginePacketType !== "4") {
            return;
        }

        const socketPacket = data.slice(1);
        if (socketPacket.startsWith(`0${this.namespace}`)) {
            this.handleNamespaceConnected();
        } else if (socketPacket.startsWith(`1${this.namespace}`)) {
            this.close();
        } else if (socketPacket.startsWith(`51-${this.namespace},`)) {
            this.handleBinaryHeader(socketPacket);
        } else if (socketPacket.startsWith(`2${this.namespace},`)) {
            this.handleTextEvent(socketPacket);
        }
    }

    handleOpenPacket(jsonText) {
        try {
            const packet = JSON.parse(jsonText);
            this.pingInterval = packet.pingInterval || this.pingInterval;
            this.pingTimeout = packet.pingTimeout || this.pingTimeout;
        } catch {
            // Keep defaults if the open packet cannot be parsed.
        }
        this.ws?.send(`40${this.namespace},`);
    }

    handleNamespaceConnected() {
        this.connected = true;
        if (this.connectTimer) {
            window.clearTimeout(this.connectTimer);
            this.connectTimer = null;
        }
        this.connectResolve?.();
        this.emitLocal("connect");
    }

    handleBinaryHeader(socketPacket) {
        const jsonStart = socketPacket.indexOf("[");
        if (jsonStart < 0) {
            return;
        }
        try {
            const packet = JSON.parse(socketPacket.slice(jsonStart));
            this.pendingBinaryPacket = packet;
        } catch (error) {
            this.emitLocal("error", error);
        }
    }

    handleTextEvent(socketPacket) {
        const jsonStart = socketPacket.indexOf("[");
        if (jsonStart < 0) {
            return;
        }
        try {
            const packet = JSON.parse(socketPacket.slice(jsonStart));
            this.emitLocal(packet[0], packet[1]);
        } catch (error) {
            this.emitLocal("error", error);
        }
    }

    handleBinary(data) {
        const packet = this.pendingBinaryPacket;
        this.pendingBinaryPacket = null;
        if (!packet || packet[0] !== "response") {
            return;
        }

        const args = packet[1] || [];
        this.emitLocal("response", [args[0], data, args[2] || []]);
    }
}

window.LocalSocketIOClient = LocalSocketIOClient;
