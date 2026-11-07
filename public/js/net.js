// WebSocket client for the relay in server/server.js.
(function (root) {
'use strict';
function connect(handlers) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = (root.SPROTO_SERVER || `${proto}//${location.host}`) + '/ws';
  const ws = new WebSocket(url);
  const api = {
    ws, id: 0, open: false,
    send(msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); },
    close() { try { ws.close(); } catch (e) { /* ignore */ } },
  };
  ws.onopen = () => { api.open = true; handlers.open && handlers.open(api); };
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } handlers.message && handlers.message(m, api); };
  ws.onclose = () => { api.open = false; handlers.close && handlers.close(api); };
  ws.onerror = () => handlers.error && handlers.error('Could not reach the game server at ' + url);
  return api;
}
root.Net = { connect };
})(window);
