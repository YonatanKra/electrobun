// src/browser/node_modules/rpc-anywhere/dist/esm/rpc.js
var missingTransportMethodError = function(methods, action) {
  const methodsString = methods.map((method) => `"${method}"`).join(", ");
  return new Error(`This RPC instance cannot ${action} because the transport did not provide one or more of these methods: ${methodsString}`);
};
function _createRPC(options = {}) {
  let debugHooks = {};
  function _setDebugHooks(newDebugHooks) {
    debugHooks = newDebugHooks;
  }
  let transport = {};
  function setTransport(newTransport) {
    if (transport.unregisterHandler)
      transport.unregisterHandler();
    transport = newTransport;
    transport.registerHandler?.(handler);
  }
  let requestHandler = undefined;
  function setRequestHandler(handler2) {
    if (typeof handler2 === "function") {
      requestHandler = handler2;
      return;
    }
    requestHandler = (method, params) => {
      const handlerFn = handler2[method];
      if (handlerFn)
        return handlerFn(params);
      const fallbackHandler = handler2._;
      if (!fallbackHandler)
        throw new Error(`The requested method has no handler: ${method}`);
      return fallbackHandler(method, params);
    };
  }
  const { maxRequestTime = DEFAULT_MAX_REQUEST_TIME } = options;
  if (options.transport)
    setTransport(options.transport);
  if (options.requestHandler)
    setRequestHandler(options.requestHandler);
  if (options._debugHooks)
    _setDebugHooks(options._debugHooks);
  let lastRequestId = 0;
  function getRequestId() {
    if (lastRequestId <= MAX_ID)
      return ++lastRequestId;
    return lastRequestId = 0;
  }
  const requestListeners = new Map;
  const requestTimeouts = new Map;
  function requestFn(method, ...args) {
    const params = args[0];
    return new Promise((resolve, reject) => {
      if (!transport.send)
        throw missingTransportMethodError(["send"], "make requests");
      const requestId = getRequestId();
      const request2 = {
        type: "request",
        id: requestId,
        method,
        params
      };
      requestListeners.set(requestId, { resolve, reject });
      if (maxRequestTime !== Infinity)
        requestTimeouts.set(requestId, setTimeout(() => {
          requestTimeouts.delete(requestId);
          reject(new Error("RPC request timed out."));
        }, maxRequestTime));
      debugHooks.onSend?.(request2);
      transport.send(request2);
    });
  }
  const request = new Proxy(requestFn, {
    get: (target, prop, receiver) => {
      if (prop in target)
        return Reflect.get(target, prop, receiver);
      return (params) => requestFn(prop, params);
    }
  });
  const requestProxy = request;
  function sendFn(message, ...args) {
    const payload = args[0];
    if (!transport.send)
      throw missingTransportMethodError(["send"], "send messages");
    const rpcMessage = {
      type: "message",
      id: message,
      payload
    };
    debugHooks.onSend?.(rpcMessage);
    transport.send(rpcMessage);
  }
  const send = new Proxy(sendFn, {
    get: (target, prop, receiver) => {
      if (prop in target)
        return Reflect.get(target, prop, receiver);
      return (payload) => sendFn(prop, payload);
    }
  });
  const sendProxy = send;
  const messageListeners = new Map;
  const wildcardMessageListeners = new Set;
  function addMessageListener(message, listener) {
    if (!transport.registerHandler)
      throw missingTransportMethodError(["registerHandler"], "register message listeners");
    if (message === "*") {
      wildcardMessageListeners.add(listener);
      return;
    }
    if (!messageListeners.has(message))
      messageListeners.set(message, new Set);
    messageListeners.get(message)?.add(listener);
  }
  function removeMessageListener(message, listener) {
    if (message === "*") {
      wildcardMessageListeners.delete(listener);
      return;
    }
    messageListeners.get(message)?.delete(listener);
    if (messageListeners.get(message)?.size === 0)
      messageListeners.delete(message);
  }
  async function handler(message) {
    debugHooks.onReceive?.(message);
    if (!("type" in message))
      throw new Error("Message does not contain a type.");
    if (message.type === "request") {
      if (!transport.send || !requestHandler)
        throw missingTransportMethodError(["send", "requestHandler"], "handle requests");
      const { id, method, params } = message;
      let response;
      try {
        response = {
          type: "response",
          id,
          success: true,
          payload: await requestHandler(method, params)
        };
      } catch (error) {
        if (!(error instanceof Error))
          throw error;
        response = {
          type: "response",
          id,
          success: false,
          error: error.message
        };
      }
      debugHooks.onSend?.(response);
      transport.send(response);
      return;
    }
    if (message.type === "response") {
      const timeout = requestTimeouts.get(message.id);
      if (timeout != null)
        clearTimeout(timeout);
      const { resolve, reject } = requestListeners.get(message.id) ?? {};
      if (!message.success)
        reject?.(new Error(message.error));
      else
        resolve?.(message.payload);
      return;
    }
    if (message.type === "message") {
      for (const listener of wildcardMessageListeners)
        listener(message.id, message.payload);
      const listeners = messageListeners.get(message.id);
      if (!listeners)
        return;
      for (const listener of listeners)
        listener(message.payload);
      return;
    }
    throw new Error(`Unexpected RPC message type: ${message.type}`);
  }
  const proxy = { send: sendProxy, request: requestProxy };
  return {
    setTransport,
    setRequestHandler,
    request,
    requestProxy,
    send,
    sendProxy,
    addMessageListener,
    removeMessageListener,
    proxy,
    _setDebugHooks
  };
}
var MAX_ID = 10000000000;
var DEFAULT_MAX_REQUEST_TIME = 1000;

// src/browser/node_modules/rpc-anywhere/dist/esm/create-rpc.js
function createRPC(options) {
  return _createRPC(options);
}
// src/browser/webviewtag.ts
var ConfigureWebviewTags = (enableWebviewTags) => {
  if (!enableWebviewTags) {
    return {
      receiveMessageFromZig: () => {
      }
    };
  }
  let rpcHandler;
  function createStdioTransport() {
    return {
      send(message) {
        window.webkit.messageHandlers.webviewTagBridge.postMessage(JSON.stringify(message));
      },
      registerHandler(handler) {
        rpcHandler = handler;
      }
    };
  }
  const receiveMessageFromZig = (msg) => {
    if (rpcHandler) {
      rpcHandler(msg);
    }
  };
  const webviewTagRPC = createRPC({
    transport: createStdioTransport(),
    maxRequestTime: 1000
  });
  let nextWebviewId = 1e4;

  class WebviewTag extends HTMLElement {
    webviewId = nextWebviewId++;
    rpc;
    resizeObserver;
    intersectionObserver;
    mutationObserver;
    positionCheckLoop;
    lastRect = {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    };
    constructor() {
      super();
      console.log("webview component created.");
      requestAnimationFrame(() => {
        this.initWebview();
      });
    }
    sendToZig(message) {
      window.webkit.messageHandlers.webviewTagBridge.postMessage(JSON.stringify(message));
    }
    initWebview() {
      const rect = this.getBoundingClientRect();
      this.lastRect = rect;
      webviewTagRPC.request.webviewTagInit({
        id: this.webviewId,
        url: this.getAttribute("src"),
        html: null,
        preload: null,
        frame: {
          width: rect.width,
          height: rect.height,
          x: rect.x,
          y: rect.y
        }
      });
    }
    syncDimensions(force = false) {
      const rect = this.getBoundingClientRect();
      const { x, y, width, height } = rect;
      const lastRect = this.lastRect;
      if (force || lastRect.x !== x || lastRect.y !== y || lastRect.width !== width || lastRect.height !== height) {
        this.lastRect = rect;
        webviewTagRPC.send.webviewTagResize({
          id: this.webviewId,
          frame: {
            width,
            height,
            x,
            y
          }
        });
      }
    }
    boundSyncDimensions = () => this.syncDimensions(true);
    connectedCallback() {
      this.positionCheckLoop = setInterval(() => this.syncDimensions(), 400);
      this.resizeObserver = new ResizeObserver(() => {
        this.syncDimensions();
      });
      window.addEventListener("resize", this.boundSyncDimensions);
    }
    disconnectedCallback() {
      clearInterval(this.positionCheckLoop);
      this.resizeObserver?.disconnect();
      this.intersectionObserver?.disconnect();
      this.mutationObserver?.disconnect();
      window.removeEventListener("resize", this.boundSyncDimensions);
    }
    static get observedAttributes() {
      return ["src", "class", "style"];
    }
    attributeChangedCallback(name, oldValue, newValue) {
      if (name === "src" && oldValue !== newValue) {
        this.updateIFrameSrc(newValue);
      } else {
        this.syncDimensions();
      }
    }
    updateIFrameSrc(src) {
      console.log(`Loading new src: ${src}`);
    }
  }
  customElements.define("electrobun-webview", WebviewTag);
  insertWebviewTagNormalizationStyles();
  return {
    receiveMessageFromZig
  };
};
var insertWebviewTagNormalizationStyles = () => {
  var style = document.createElement("style");
  style.type = "text/css";
  var css = `
electrobun-webview {
    display: block;
    width: 800px;
    height: 300px;
    background: #333;
}
`;
  style.appendChild(document.createTextNode(css));
  var head = document.getElementsByTagName("head")[0];
  if (!head) {
    return;
  }
  if (head.firstChild) {
    head.insertBefore(style, head.firstChild);
  } else {
    head.appendChild(style);
  }
};

// src/browser/index.ts
class Electroview {
  rpc;
  rpcHandler;
  constructor(config) {
    this.rpc = config.rpc;
    this.init();
  }
  init() {
    const { receiveMessageFromZig } = ConfigureWebviewTags(true);
    window.__electrobun = {
      receiveMessageFromBun: this.receiveMessageFromBun.bind(this),
      receiveMessageFromZig
    };
    if (this.rpc) {
      this.rpc.setTransport(this.createTransport());
    }
  }
  createTransport() {
    const that = this;
    return {
      send(message) {
        try {
          const messageString = JSON.stringify(message);
          that.bunBridge(messageString);
        } catch (error) {
          console.error("bun: failed to serialize message to webview", error);
        }
      },
      registerHandler(handler) {
        that.rpcHandler = handler;
      }
    };
  }
  bunBridge(msg) {
    window.webkit.messageHandlers.bunBridge.postMessage(msg);
  }
  receiveMessageFromBun(msg) {
    document.body.innerHTML += "receiving message from bun";
    if (this.rpcHandler) {
      this.rpcHandler(msg);
    }
  }
  static defineRPC(config) {
    const rpcOptions = {
      maxRequestTime: config.maxRequestTime,
      requestHandler: config.handlers.requests,
      transport: {
        registerHandler: () => {
        }
      }
    };
    const rpc2 = createRPC(rpcOptions);
    const messageHandlers = config.handlers.messages;
    if (messageHandlers) {
      rpc2.addMessageListener("*", (messageName, payload) => {
        const globalHandler = messageHandlers["*"];
        if (globalHandler) {
          globalHandler(messageName, payload);
        }
        const messageHandler = messageHandlers[messageName];
        if (messageHandler) {
          messageHandler(payload);
        }
      });
    }
    return rpc2;
  }
}
var ElectrobunView = {
  Electroview
};
var browser_default = ElectrobunView;
export {
  browser_default as default,
  createRPC,
  Electroview
};
