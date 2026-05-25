export const CHANNEL_NAME = "boat:global";
export const PUBLISH_INTERVAL_MS = 1000; // Increased to 1000ms to reduce network traffic congestion by 90% (Lerp guarantees smooth visual movement)

export function createPlayerId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `player-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `player-${Date.now().toString(36)}`;
}

class MockAblyChannel {
  constructor(channelName, clientId) {
    this.name = channelName;
    this.clientId = clientId;
    this.listeners = {};
    this.presenceListeners = [];
    this.presenceMembers = new Map();
    this.myPresenceData = null;

    try {
      this.bc = new BroadcastChannel(channelName);
      this.bc.onmessage = (e) => {
        const { type, data, senderId } = e.data;
        if (type === "pub") {
          const { eventName, msgData } = data;
          if (this.listeners[eventName]) {
            this.listeners[eventName].forEach((cb) =>
              cb({ data: msgData, clientId: senderId })
            );
          }
        } else if (type === "presence_enter") {
          this.presenceMembers.set(senderId, data);
          this.triggerPresence();
          if (this.myPresenceData) {
            this.bc.postMessage({
              type: "presence_reply",
              data: this.myPresenceData,
              senderId: this.clientId,
            });
          }
        } else if (type === "presence_reply") {
          this.presenceMembers.set(senderId, data);
          this.triggerPresence();
        } else if (type === "presence_leave") {
          this.presenceMembers.delete(senderId);
          this.triggerPresence();
        } else if (type === "presence_query") {
          if (this.myPresenceData) {
            this.bc.postMessage({
              type: "presence_reply",
              data: this.myPresenceData,
              senderId: this.clientId,
            });
          }
        }
      };
    } catch (err) {
      console.warn("BroadcastChannel not supported, running client-only mock.", err);
    }
  }

  setPresenceData(data) {
    this.myPresenceData = data;
    this.presenceMembers.set(this.clientId, data);
    if (this.bc) {
      this.bc.postMessage({
        type: "presence_enter",
        data,
        senderId: this.clientId,
      });
    }
    this.triggerPresence();
  }

  publish(eventName, msgData) {
    if (this.bc) {
      this.bc.postMessage({
        type: "pub",
        data: { eventName, msgData },
        senderId: this.clientId,
      });
    }
  }

  subscribe(eventName, callback) {
    if (!this.listeners[eventName]) {
      this.listeners[eventName] = [];
    }
    this.listeners[eventName].push(callback);
  }

  triggerPresence() {
    this.presenceListeners.forEach((cb) => cb());
  }

  get presence() {
    return {
      subscribe: (callback) => {
        this.presenceListeners.push(callback);
      },
      enter: (data, callback) => {
        this.setPresenceData(data);
        if (callback) callback(null);
        return Promise.resolve();
      },
      get: (callback) => {
        if (this.bc) {
          this.bc.postMessage({
            type: "presence_query",
            senderId: this.clientId,
          });
        }
        const membersList = Array.from(this.presenceMembers.entries()).map(
          ([cid, data]) => ({
            clientId: cid,
            data,
          })
        );
        if (callback) callback(null, membersList);
        return Promise.resolve(membersList);
      },
    };
  }
}

function waitForConnection(ably) {
  return new Promise((resolve, reject) => {
    if (ably.connection.state === "connected") {
      resolve();
      return;
    }
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("Ably connection timed out (8s limit reached)"));
    }, 8000); // 8s connection timeout limit to prevent infinite hang

    const onConnected = () => {
      clearTimeout(timeoutId);
      cleanup();
      resolve();
    };
    const onFailed = (err) => {
      clearTimeout(timeoutId);
      cleanup();
      reject(err?.reason || new Error("Ably connection failed"));
    };
    const cleanup = () => {
      ably.connection.off("connected", onConnected);
      ably.connection.off("failed", onFailed);
    };
    ably.connection.on("connected", onConnected);
    ably.connection.on("failed", onFailed);
  });
}

async function fetchTokenRequest(clientId) {
  const authUrl = `/api/ably-token?clientId=${encodeURIComponent(clientId)}`;
  const res = await fetch(authUrl, { credentials: "same-origin" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body.error || body.detail || `HTTP ${res.status}`;
    const hint = body.hint ? ` ${body.hint}` : "";
    throw new Error(`${msg}${hint}`);
  }
  return body;
}

export async function connectAbly({ clientId, name, color, role }) {
  let ablyObj = null;
  let channelObj = null;
  let useMock = false;

  // Quick check if /api/ably-token is working and reachable
  try {
    if (typeof Ably === "undefined") {
      useMock = true;
    } else {
      const authUrl = `/api/ably-token?clientId=test-probe`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8.0s timeout instead of 1.2s to support laggy 3G/4G
      
      const res = await fetch(authUrl, { 
        credentials: "same-origin",
        signal: controller.signal 
      });
      clearTimeout(timeoutId);
      
      const contentType = res.headers.get("content-type") || "";
      if (!res.ok || !contentType.includes("application/json")) {
        useMock = true;
      }
    }
  } catch (err) {
    useMock = true;
  }

  if (useMock) {
    console.warn("Local probe failed or Ably missing. Falling back to local BroadcastChannel mock.");
    channelObj = new MockAblyChannel(CHANNEL_NAME, clientId);
  } else {
    try {
      const ably = new Ably.Realtime({
        authCallback: async (_tokenParams, callback) => {
          try {
            const tokenRequest = await fetchTokenRequest(clientId);
            callback(null, tokenRequest);
          } catch (err) {
            callback(err.message || String(err), null);
          }
        },
        clientId,
        echoMessages: false,
      });

      await waitForConnection(ably);
      ablyObj = ably;
      channelObj = ably.channels.get(CHANNEL_NAME);
    } catch (err) {
      console.warn(
        "Ably connection failed, falling back to local BroadcastChannel mock:",
        err
      );
      channelObj = new MockAblyChannel(CHANNEL_NAME, clientId);
    }
  }

  await presenceEnter(channelObj, { name, color, role });
  if (channelObj instanceof MockAblyChannel && channelObj.bc) {
    channelObj.bc.postMessage({
      type: "presence_query",
      senderId: clientId,
    });
  }

  return { ably: ablyObj, channel: channelObj, clientId };
}

function normalizePresenceList(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw?.items && Array.isArray(raw.items)) return raw.items;
  return [];
}

function promisifyPresenceGet(channel) {
  return new Promise((resolve, reject) => {
    const result = channel.presence.get();
    if (result && typeof result.then === "function") {
      result.then((m) => resolve(normalizePresenceList(m))).catch(reject);
      return;
    }
    channel.presence.get((err, members) => {
      if (err) reject(err);
      else resolve(normalizePresenceList(members));
    });
  });
}

function presenceEnter(channel, data) {
  return new Promise((resolve, reject) => {
    const result = channel.presence.enter(data);
    if (result && typeof result.then === "function") {
      result.then(resolve).catch(reject);
      return;
    }
    channel.presence.enter(data, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export async function getPresenceMembers(channel) {
  const members = await promisifyPresenceGet(channel);
  return presenceToPlayers(members);
}

export function presenceToPlayers(members) {
  const list = normalizePresenceList(members);
  return list
    .filter((m) => m.data?.role === "player")
    .map((m) => ({
      id: m.clientId,
      sid: m.clientId,
      name: m.data?.name || "Anonymous",
      color: m.data?.color || "#e74c3c",
      progress: m.data?.progress ?? 0,
      rank: m.data?.rank ?? null,
    }));
}

