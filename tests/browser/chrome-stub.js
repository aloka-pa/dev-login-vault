// Stub of chrome.runtime for content-script tests. Records sent messages; replies come from window.stubReplies[type].
window.sent = [];
window.stubReplies = {};
window.stubListeners = [];
window.chrome = {
  runtime: {
    id: 'test',
    sendMessage: async (message) => {
      window.sent.push(message);
      const reply = window.stubReplies[message.type];
      return typeof reply === 'function' ? reply(message) : reply ?? { ok: true, data: null };
    },
    onMessage: { addListener: (fn) => window.stubListeners.push(fn) },
  },
};
