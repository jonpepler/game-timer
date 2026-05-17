import { describe, expect, it, vi } from "vitest";
import { connectToHost, createHost } from "./peer";

// Minimal fake of the peerjs Peer + DataConnection surface — just enough
// for createHost to drive its event listeners. Tests reach in via the
// captured instance to fire the events that simulate the broker /
// remote peer.
class FakeConnection {
  open = false;
  private handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  sent: unknown[] = [];

  constructor(public peer: string) {}

  on(event: string, handler: (...args: unknown[]) => void) {
    (this.handlers[event] ??= []).push(handler);
  }

  emit(event: string, ...args: unknown[]) {
    (this.handlers[event] ?? []).forEach((h) => h(...args));
  }

  send(data: unknown) {
    this.sent.push(data);
  }
}

class FakePeer {
  private handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  destroyed = false;
  outboundConnections: FakeConnection[] = [];
  static instances: FakePeer[] = [];

  constructor() {
    FakePeer.instances.push(this);
  }

  on(event: string, handler: (...args: unknown[]) => void) {
    (this.handlers[event] ??= []).push(handler);
  }

  emit(event: string, ...args: unknown[]) {
    (this.handlers[event] ?? []).forEach((h) => h(...args));
  }

  connect(remoteId: string) {
    const conn = new FakeConnection(remoteId);
    this.outboundConnections.push(conn);
    return conn;
  }

  destroy() {
    this.destroyed = true;
  }
}

describe("createHost", () => {
  it("resolves with a session code once the peer opens", async () => {
    FakePeer.instances = [];
    const promise = createHost({
      PeerCtor: FakePeer as unknown as never,
    });
    // Drive the open event after a microtask so the promise has a chance
    // to subscribe.
    queueMicrotask(() => {
      FakePeer.instances[0].emit("open", "abc-123");
    });
    const session = await promise;
    expect(session.sessionCode).toBe("abc-123");
    expect(session.connections()).toEqual([]);
  });

  it("notifies onConnect / onMessage / onDisconnect for an incoming companion", async () => {
    FakePeer.instances = [];
    const promise = createHost({ PeerCtor: FakePeer as unknown as never });
    queueMicrotask(() => FakePeer.instances[0].emit("open", "host-1"));
    const session = await promise;

    const connects: string[] = [];
    const messages: { peerId: string; data: unknown }[] = [];
    const disconnects: string[] = [];
    session.onConnect((id) => connects.push(id));
    session.onMessage((id, data) => messages.push({ peerId: id, data }));
    session.onDisconnect((id) => disconnects.push(id));

    const conn = new FakeConnection("companion-1");
    FakePeer.instances[0].emit("connection", conn);
    conn.open = true;
    conn.emit("open");
    expect(connects).toEqual(["companion-1"]);
    expect(session.connections()).toEqual(["companion-1"]);

    conn.emit("data", { hello: "world" });
    expect(messages).toEqual([
      { peerId: "companion-1", data: { hello: "world" } },
    ]);

    conn.emit("close");
    expect(disconnects).toEqual(["companion-1"]);
    expect(session.connections()).toEqual([]);
  });

  it("send broadcasts to every open connection", async () => {
    FakePeer.instances = [];
    const promise = createHost({ PeerCtor: FakePeer as unknown as never });
    queueMicrotask(() => FakePeer.instances[0].emit("open", "host-1"));
    const session = await promise;

    const a = new FakeConnection("a");
    const b = new FakeConnection("b");
    FakePeer.instances[0].emit("connection", a);
    FakePeer.instances[0].emit("connection", b);
    a.open = true;
    b.open = true;
    a.emit("open");
    b.emit("open");

    session.send({ type: "STATE", v: 1 });
    expect(a.sent).toEqual([{ type: "STATE", v: 1 }]);
    expect(b.sent).toEqual([{ type: "STATE", v: 1 }]);
  });

  it("close destroys the underlying peer", async () => {
    FakePeer.instances = [];
    const promise = createHost({ PeerCtor: FakePeer as unknown as never });
    queueMicrotask(() => FakePeer.instances[0].emit("open", "host-1"));
    const session = await promise;

    session.close();
    expect(FakePeer.instances[0].destroyed).toBe(true);
  });

  it("rejects when the peer errors before opening", async () => {
    FakePeer.instances = [];
    const promise = createHost({ PeerCtor: FakePeer as unknown as never });
    queueMicrotask(() => {
      FakePeer.instances[0].emit("error", new Error("broker offline"));
    });
    await expect(promise).rejects.toThrow(/broker offline/);
  });

  it("does not reject for errors that happen after open", async () => {
    FakePeer.instances = [];
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const promise = createHost({ PeerCtor: FakePeer as unknown as never });
    queueMicrotask(() => FakePeer.instances[0].emit("open", "host-1"));
    const session = await promise;

    // Late error — should not reject (promise already resolved) and
    // should not throw synchronously.
    expect(() =>
      FakePeer.instances[0].emit("error", new Error("transient")),
    ).not.toThrow();
    expect(session.sessionCode).toBe("host-1");
    consoleSpy.mockRestore();
  });
});

describe("connectToHost", () => {
  it("resolves with a CompanionSession once the outbound connection opens", async () => {
    FakePeer.instances = [];
    const promise = connectToHost("host-abc", {
      PeerCtor: FakePeer as unknown as never,
    });
    queueMicrotask(() => {
      const peer = FakePeer.instances[0];
      peer.emit("open", "companion-1");
      const conn = peer.outboundConnections[0];
      expect(conn.peer).toBe("host-abc");
      conn.open = true;
      conn.emit("open");
    });
    const session = await promise;
    expect(session.hostCode).toBe("host-abc");
  });

  it("relays inbound messages to onMessage handlers", async () => {
    FakePeer.instances = [];
    const promise = connectToHost("host-abc", {
      PeerCtor: FakePeer as unknown as never,
    });
    queueMicrotask(() => {
      const peer = FakePeer.instances[0];
      peer.emit("open", "companion-1");
      const conn = peer.outboundConnections[0];
      conn.open = true;
      conn.emit("open");
    });
    const session = await promise;

    const received: unknown[] = [];
    session.onMessage((data) => received.push(data));
    const conn = FakePeer.instances[0].outboundConnections[0];
    conn.emit("data", { type: "STATE", value: 42 });
    expect(received).toEqual([{ type: "STATE", value: 42 }]);
  });

  it("send writes to the outbound connection", async () => {
    FakePeer.instances = [];
    const promise = connectToHost("host-abc", {
      PeerCtor: FakePeer as unknown as never,
    });
    queueMicrotask(() => {
      const peer = FakePeer.instances[0];
      peer.emit("open", "companion-1");
      const conn = peer.outboundConnections[0];
      conn.open = true;
      conn.emit("open");
    });
    const session = await promise;
    session.send({ ping: 1 });
    expect(
      FakePeer.instances[0].outboundConnections[0].sent,
    ).toEqual([{ ping: 1 }]);
  });

  it("onClose fires when the host hangs up", async () => {
    FakePeer.instances = [];
    const promise = connectToHost("host-abc", {
      PeerCtor: FakePeer as unknown as never,
    });
    queueMicrotask(() => {
      const peer = FakePeer.instances[0];
      peer.emit("open", "companion-1");
      const conn = peer.outboundConnections[0];
      conn.open = true;
      conn.emit("open");
    });
    const session = await promise;
    let closed = false;
    session.onClose(() => {
      closed = true;
    });
    const conn = FakePeer.instances[0].outboundConnections[0];
    conn.emit("close");
    expect(closed).toBe(true);
  });

  it("rejects when the connection errors before opening", async () => {
    FakePeer.instances = [];
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const promise = connectToHost("host-abc", {
      PeerCtor: FakePeer as unknown as never,
    });
    queueMicrotask(() => {
      const peer = FakePeer.instances[0];
      peer.emit("open", "companion-1");
      const conn = peer.outboundConnections[0];
      conn.emit("error", new Error("host not found"));
    });
    await expect(promise).rejects.toThrow(/host not found/);
    consoleSpy.mockRestore();
  });
});
