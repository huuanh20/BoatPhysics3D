export const CHANNEL_NAME = "boat:global";
export const PUBLISH_INTERVAL_MS = 75;

export function createPlayerId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `player-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `player-${Date.now().toString(36)}`;
}

function waitForConnection(ably) {
  return new Promise((resolve, reject) => {
    if (ably.connection.state === "connected") {
      resolve();
      return;
    }
    const onConnected = () => {
      cleanup();
      resolve();
    };
    const onFailed = (err) => {
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

export async function connectAbly({ clientId, name, color, role }) {
  const authUrl = `/api/ably-token?clientId=${encodeURIComponent(clientId)}`;
  const ably = new Ably.Realtime({
    authUrl,
    clientId,
    echoMessages: false,
  });

  await waitForConnection(ably);
  const channel = ably.channels.get(CHANNEL_NAME);
  await channel.presence.enter({ name, color, role });
  return { ably, channel, clientId };
}

export async function getPresenceMembers(channel) {
  const members = await channel.presence.get();
  return members
    .filter((m) => m.data?.role === "player")
    .map((m) => ({
      id: m.clientId,
      name: m.data?.name || "Anonymous",
      color: m.data?.color || "#e74c3c",
      progress: m.data?.progress ?? 0,
      rank: m.data?.rank ?? null,
    }));
}

export function presenceToPlayers(members) {
  return members
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
