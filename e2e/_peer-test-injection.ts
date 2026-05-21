/*
 * BroadcastChannel-based fake of the PeerJS layer for multi-page
 * Playwright tests. Injected into both host and companion pages via
 * `page.addInitScript` so they speak to each other without contacting
 * the real PeerJS broker.
 *
 * Channel name: `peer-test:<hostPeerId>`. Both host and companions
 * subscribe to the same channel keyed by the host's peer id; messages
 * carry { from, to, type, data } so the receiver can route them.
 *
 * Message types:
 *   connect      companion → host: "I want to attach as <from>"
 *   connect-ack  host → companion: "you're attached"
 *   disconnect   companion → host: "I'm leaving"
 *   data         either direction: actual peer-protocol payload
 *
 * The script is shipped as a string so Playwright can inject it via
 * `addInitScript({ content: PEER_TEST_INIT_SCRIPT })` without needing
 * a separate build step.
 */
export const PEER_TEST_INIT_SCRIPT = `
(() => {
  const NS = "peer-test";
  const randomId = () => Math.random().toString(36).slice(2, 10);

  window.__PEER_TEST_FACTORY = {
    createHost: async (options) => {
      const hostPeerId = (options && options.desiredId) || ("host-" + randomId());
      const channel = new BroadcastChannel(NS + ":" + hostPeerId);
      const conns = new Map();
      let connectHandlers = [];
      let disconnectHandlers = [];
      let messageHandlers = [];

      channel.addEventListener("message", (ev) => {
        const m = ev.data;
        if (!m || m.to !== "host") return;
        if (m.type === "connect") {
          conns.set(m.from, true);
          channel.postMessage({
            from: "host",
            to: m.from,
            type: "connect-ack",
          });
          connectHandlers.forEach((h) => h(m.from));
        } else if (m.type === "data") {
          messageHandlers.forEach((h) => h(m.from, m.data));
        } else if (m.type === "disconnect") {
          if (conns.delete(m.from)) {
            disconnectHandlers.forEach((h) => h(m.from));
          }
        }
      });

      return {
        sessionCode: hostPeerId,
        send: (data) => {
          conns.forEach((_, peerId) => {
            channel.postMessage({ from: "host", to: peerId, type: "data", data });
          });
        },
        onConnect: (h) => {
          connectHandlers.push(h);
          return () => {
            connectHandlers = connectHandlers.filter((x) => x !== h);
          };
        },
        onDisconnect: (h) => {
          disconnectHandlers.push(h);
          return () => {
            disconnectHandlers = disconnectHandlers.filter((x) => x !== h);
          };
        },
        onMessage: (h) => {
          messageHandlers.push(h);
          return () => {
            messageHandlers = messageHandlers.filter((x) => x !== h);
          };
        },
        connections: () => Array.from(conns.keys()),
        close: () => {
          channel.close();
        },
      };
    },

    connectToHost: async (hostCode) => {
      const channel = new BroadcastChannel(NS + ":" + hostCode);
      const myId = "companion-" + randomId();
      let messageHandlers = [];
      let closeHandlers = [];

      const ackPromise = new Promise((resolve) => {
        const onMsg = (ev) => {
          const m = ev.data;
          if (!m || m.to !== myId) return;
          if (m.type === "connect-ack") {
            channel.removeEventListener("message", onMsg);
            resolve();
          }
        };
        channel.addEventListener("message", onMsg);
      });

      channel.addEventListener("message", (ev) => {
        const m = ev.data;
        if (!m || m.to !== myId) return;
        if (m.type === "data") {
          messageHandlers.forEach((h) => h(m.data));
        } else if (m.type === "host-closed") {
          closeHandlers.forEach((h) => h());
        }
      });

      channel.postMessage({ from: myId, to: "host", type: "connect" });
      await ackPromise;

      return {
        hostCode,
        peerId: myId,
        send: (data) => {
          channel.postMessage({ from: myId, to: "host", type: "data", data });
        },
        onMessage: (h) => {
          messageHandlers.push(h);
          return () => {
            messageHandlers = messageHandlers.filter((x) => x !== h);
          };
        },
        onClose: (h) => {
          closeHandlers.push(h);
          return () => {
            closeHandlers = closeHandlers.filter((x) => x !== h);
          };
        },
        onConnectionStateChange: (h) => {
          // Fake never reconnects — fire 'connected' immediately so
          // the hook lands on "connected" status, mirroring the
          // real session's replay-on-subscribe behavior.
          h("connected");
          return () => {};
        },
        close: () => {
          channel.postMessage({ from: myId, to: "host", type: "disconnect" });
          channel.close();
        },
      };
    },
  };
})();
`;
