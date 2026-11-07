// Hub page settings for Sproto Coop Battle. No Nakama HTTP key belongs here.
// Loopback play fills the public dev server key in hub-link.js. A deploy may set
// window.SPROTO_COOP_HUB.serverKey to Nakama's client server key before this file.
(function (root) {
  'use strict';
  var prior = root.SPROTO_COOP_HUB || {};
  root.SPROTO_COOP_HUB = {
    gameId: 'sproto-coop-battle',
    serverUrl: prior.serverUrl != null ? prior.serverUrl : '',
    serverKey: prior.serverKey != null ? prior.serverKey : '',
    hubUrl: prior.hubUrl != null ? prior.hubUrl : '',
  };
})(typeof window !== 'undefined' ? window : globalThis);
