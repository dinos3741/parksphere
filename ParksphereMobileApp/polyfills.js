// Polyfills for Web APIs missing in React Native but required by some libraries like MSW
if (typeof BroadcastChannel === 'undefined') {
  global.BroadcastChannel = class BroadcastChannel extends EventTarget {
    constructor(name) {
      super();
      this.name = name;
      this.closed = false;
    }
    postMessage(message) {
      if (this.closed) throw new Error('BroadcastChannel is closed');
      // In React Native, simple broadcast is often not needed; 
      // this is a no-op to satisfy the API
    }
    close() {
      this.closed = true;
    }
  };
}

if (typeof EventTarget === 'undefined') {
  global.EventTarget = class EventTarget {
    constructor() {
      this.listeners = {};
    }
    addEventListener(type, callback) {
      if (!(type in this.listeners)) {
        this.listeners[type] = [];
      }
      this.listeners[type].push(callback);
    }
    removeEventListener(type, callback) {
      if (!(type in this.listeners)) return;
      const stack = this.listeners[type];
      for (let i = 0, l = stack.length; i < l; i++) {
        if (stack[i] === callback) {
          stack.splice(i, 1);
          return;
        }
      }
    }
    dispatchEvent(event) {
      if (!(event.type in this.listeners)) return true;
      const stack = this.listeners[event.type].slice();
      for (let i = 0, l = stack.length; i < l; i++) {
        stack[i].call(this, event);
      }
      return !event.defaultPrevented;
    }
  };
}

if (typeof Event === 'undefined') {
  global.Event = class Event {
    constructor(type, init) {
      this.type = type;
      this.bubbles = !!init?.bubbles;
      this.cancelable = !!init?.cancelable;
      this.defaultPrevented = false;
    }
    preventDefault() {
      this.defaultPrevented = true;
    }
  };
}

if (typeof CustomEvent === 'undefined') {
  global.CustomEvent = class CustomEvent extends global.Event {
    constructor(type, init) {
      super(type, init);
      this.detail = init?.detail || null;
    }
  };
}

if (typeof MessageEvent === 'undefined') {
  global.MessageEvent = class MessageEvent extends global.Event {
    constructor(type, init) {
      super(type, init);
      this.data = init?.data;
      this.origin = init?.origin;
      this.lastEventId = init?.lastEventId;
      this.source = init?.source;
      this.ports = init?.ports;
    }
  };
}
