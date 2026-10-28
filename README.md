# AbrovaPush Web SDK

Real-time push notifications for browsers. No Firebase dependency.

## Features

- Real-time push notifications via WebSocket
- Web Push (VAPID) for background notifications when browser is closed
- Rich notifications (images, action buttons, badges, deep links)
- Topic subscriptions
- Auto-reconnection with exponential backoff
- Network and visibility state monitoring
- Badge management (Badge API + favicon fallback)
- Localization support
- Analytics tracking
- TypeScript support
- Works with any framework (React, Vue, Angular, vanilla JS)

## Installation

### NPM

The package is published on [Abrova Center](https://center.abrova.ir). Add this line to your project's `.npmrc`:

```ini
@abrova:registry=https://center.abrova.ir/api/packages/abrova/npm/
```

Then install:

```bash
npm install @abrova/push-web
```

### CDN (UMD)

```html
<script src="https://unpkg.com/@abrova/push-web/dist/index.umd.js"></script>
```

### CDN (ES Module)

```html
<script type="module">
  import AbrovaPush from 'https://unpkg.com/@abrova/push-web/dist/index.esm.js';
</script>
```

## Service Worker Setup

Copy the service worker file to your public directory:

```bash
# NPM
cp node_modules/@abrova/push-web/service-worker.js public/abrova-push-sw.js

# CDN
curl -o public/abrova-push-sw.js https://unpkg.com/@abrova/push-web/service-worker.js
```

Let the SDK register it (`init()` does this for you). It registers the worker
with its API key and device id on the URL, and mirrors the same values into
IndexedDB under `abrova-push` / `config`.

The worker needs those two values to confirm delivery and to re-register a
subscription the browser replaces. It reads the URL first and falls back to
storage, so it keeps working even when something else registered
`/abrova-push-sw.js` without the query string - your own
`navigator.serviceWorker.register` call, another library, or a hot reload in
development. Nothing secret is stored: the API key is public and already in
your page.

Where IndexedDB is unavailable (private windows, blocked site data), only the
URL is used, exactly as before. A worker with neither says so in the console:

```
[AbrovaPush SW] Delivery ack skipped - no SDK config in the worker URL or in storage
```

## Quick Start

```typescript
import AbrovaPush from '@abrova/push-web';

// Initialize
const abrovaPush = new AbrovaPush({
  apiKey: 'ab_live_your_api_key',  // Get from Abrova Console
});

// Set up callbacks
abrovaPush.onMessage((message) => {
  console.log('Title:', message.title);
  console.log('Body:', message.body);
  console.log('Data:', message.data);
});

abrovaPush.onConnectionState((state) => {
  console.log('Connection:', state); // 'connected' | 'disconnected' | 'connecting'
});

abrovaPush.onRegistered((deviceId) => {
  console.log('Device ID:', deviceId);
});

// Register device (requests notification permission automatically)
const deviceId = await abrovaPush.register({ userId: 'user_123' });
```

## Configuration

```typescript
const abrovaPush = new AbrovaPush({
  apiKey: 'ab_live_...',                    // Required - from Abrova Console
  serviceWorkerPath: '/abrova-push-sw.js',  // Optional - service worker path
  autoRegisterServiceWorker: true,          // Optional - auto register SW (default: true)
  mqttQos: 1,                              // Optional - MQTT QoS level (default: 1)
  maxReconnectAttempts: 0,                  // Optional - max reconnect attempts (default: 0 = keep trying)
  logLevel: AbrovaPushLogLevel.ERROR,       // Optional - log level
  appVersion: '2.0.0',                      // Optional - your app version (segment filter)
  autoRefresh: true,                        // Optional - background re-registration (default: true)
});
```

### Automatic refresh

With `autoRefresh` on (the default), a browser that has registered before is
silently re-registered on page load when its registration is likely stale: 24
hours have passed, the push subscription endpoint changed, or `appVersion`, the
SDK version or the user ID changed. It never shows a permission prompt (it only
runs when permission is already granted) and never throws. Calling `register()`
yourself still always registers.

### SDK version

```typescript
import { SDK_VERSION } from '@abrova/push-web';
console.log(SDK_VERSION); // "0.1.5"
```

The SDK reports `sdkName` / `sdkVersion`, the OS and the browser (as
`osVersion` / `deviceModel`) when registering, so they show up in the dashboard.

## Callbacks

All event handlers return an unsubscribe function.

```typescript
// Receive messages (foreground)
const unsub = abrovaPush.onMessage((message) => {
  console.log(message.title, message.body);
});

// Connection state
abrovaPush.onConnectionState((state) => {
  // 'connecting' | 'connected' | 'disconnected' | 'error'
});

// Registration complete
abrovaPush.onRegistered((deviceId) => {});

// Background notification click
abrovaPush.onNotificationClick((message, action) => {
  if (message.deepLink) {
    window.location.href = message.deepLink;
  }
});

// Action button click
abrovaPush.onActionClicked((actionId, message) => {
  console.log('Action:', actionId);
});

// Errors
abrovaPush.onError((error) => {});
abrovaPush.onDetailedError((error) => {
  console.log('Code:', error.code, 'Message:', error.message);
});

// Reconnection
abrovaPush.onReconnecting((state) => {
  console.log('Attempt:', state.retryAttempt, 'Next in:', state.nextRetryMs, 'ms');
});

// Network state
abrovaPush.onNetworkState((state) => {
  console.log('Online:', state.isAvailable, 'Type:', state.networkType);
});

// App visibility
abrovaPush.onAppState((state) => {
  console.log('Visible:', state.isVisible);
});

// Clean up
unsub();
```

## Topics

```typescript
await abrovaPush.subscribeTopic('news');
await abrovaPush.subscribeTopic('promotions');
await abrovaPush.unsubscribeTopic('promotions');
```

## User Management

```typescript
// Set user ID after login
await abrovaPush.setUserId('user_123');

// Clear user ID on logout
abrovaPush.clearUserId();

// Register with user ID
await abrovaPush.register({ userId: 'user_123' });
```

### Signed user tokens

Optional. By default the server trusts the `userId` the page sends. With a
token provider, every request carries a short-lived Abrova user token issued
by your server, so the user is proven rather than claimed. It is the same
token, and can be the same function, you pass to Abrova Chat and Abrova Sync.

```typescript
// Your server mints the token for the signed-in user; return null when signed out.
const tokenProvider = async () => {
  const res = await fetch('/api/abrova-token', { credentials: 'include' });
  return res.ok ? (await res.json()).token : null;
};

const abrovaPush = new AbrovaPush({ apiKey: 'ab_live_your_api_key', tokenProvider });

abrovaPush.onAuthError((event) => {
  // token_invalid | token_required | token_mismatch | token_expired | token_provider_failed
  console.warn('Abrova auth error:', event.code, event.message);
});
```

The SDK caches the token in memory, renews it shortly before it expires and
retries once when the server reports it expired. A failing provider never
blocks registration or delivery. You can also call `setTokenProvider(fn)`
later, or `setUserToken(token)` if you fetch the token yourself.

## Badge Management

```typescript
abrovaPush.setBadgeCount(5);
abrovaPush.clearBadge();
const count = abrovaPush.getBadgeCount();
```

## Analytics

```typescript
abrovaPush.setAnalyticsHandler((event, properties) => {
  // Send to your analytics service
  analytics.track(`abrova_push_${event}`, properties);
});

abrovaPush.disableAnalytics();
```

## Log Levels

```typescript
import { AbrovaPushLogLevel } from '@abrova/push-web';

abrovaPush.setLogLevel(AbrovaPushLogLevel.DEBUG);   // Development
abrovaPush.setLogLevel(AbrovaPushLogLevel.ERROR);   // Production

// Available: NONE, ERROR, WARNING, INFO, DEBUG, VERBOSE
```

## Utilities

```typescript
const connected = abrovaPush.isConnected();
const deviceId = abrovaPush.getDeviceId();
const network = abrovaPush.getNetworkState();
const appState = abrovaPush.getAppState();
const initialMessage = abrovaPush.getInitialMessage();

// Static methods
AbrovaPush.isSupported();
AbrovaPush.getPermissionStatus();

// Unregister
await abrovaPush.unregister();
```

## CDN Usage (HTML)

```html
<!DOCTYPE html>
<html>
<head>
  <title>My App</title>
</head>
<body>
  <script src="https://unpkg.com/@abrova/push-web/dist/index.umd.js"></script>
  <script>
    const abrovaPush = new AbrovaPushWeb.default({
      apiKey: 'ab_live_your_api_key',
    });

    abrovaPush.onMessage(function(message) {
      console.log('Received:', message.title);
    });

    abrovaPush.onConnectionState(function(state) {
      console.log('Connection:', state);
    });

    abrovaPush.register().then(function(deviceId) {
      console.log('Registered:', deviceId);
    });
  </script>
</body>
</html>
```

## Message Inbox

Inbox messages are stored server-side and stay available until the user reads,
archives or deletes them. `abrovaPush.inbox` needs a registered device.

```typescript
// Live updates (an inbox message never shows a notification)
abrovaPush.inbox.onMessage((message) => console.log(message.content.title));
abrovaPush.inbox.onUnreadCountChange((count) => setBadge(count));

// Read
const { messages, total, unreadCount } = await abrovaPush.inbox.getMessages({
  status: 'unread',
  limit: 20,
});
const cached = abrovaPush.inbox.getCachedMessages(); // instant, no network

// Write
await abrovaPush.inbox.markAsRead(messages[0].id);
await abrovaPush.inbox.archiveMessage(messages[0].id);
await abrovaPush.inbox.deleteMessage(messages[0].id);
await abrovaPush.inbox.markMultiple(['id-1', 'id-2'], 'read');
await abrovaPush.inbox.markAllAsRead();
```

Messages are cached per device and restored on the next page load. The cache is
dropped when the user changes (`setUserId` / `clearUserId`).

## In-App Messages

In-app messages are campaigns shown inside your page — a modal, banner,
fullscreen takeover or card — when a trigger fires. `abrovaPush.inApp` needs a
registered device.

```typescript
const abrovaPush = new AbrovaPush({
  apiKey: 'ab_live_your_api_key',
  inApp: {
    display: 'auto',        // 'manual' to render your own UI
    autoTrigger: false,     // true fires session-start + app-open on page load
    bannerPosition: 'top',
  },
});

abrovaPush.inApp.onMessageReady((message) => console.log(message.name));
abrovaPush.inApp.onButtonClicked((message, button) => {
  if (button.action === 'custom') doSomething(button.value);
});
abrovaPush.inApp.onDismissed((message) => console.log('closed', message.id));

await abrovaPush.inApp.triggerOnAppOpen();
await abrovaPush.inApp.triggerEvent('purchase_completed', { plan: 'pro' });
```

The built-in UI renders into a **shadow DOM** root, so your page's CSS can never
break it and the SDK's CSS never leaks into your page. Modals and fullscreen
messages are dialogs (`role="dialog"`, `aria-modal`, focus trap, focus restored
on close, dismissible with Escape or a backdrop click); banners and cards are
polite live regions. Reduced-motion preferences are respected.

With `display: 'manual'` nothing is inserted into the page: you get
`onMessageReady` and render the message yourself, then call
`abrovaPush.inApp.recordImpression(id, 'button_click', buttonId)` and
`abrovaPush.inApp.dismissCurrentMessage()` as the user interacts.

Eligible messages are cached per device for 5 minutes, and impression counts,
schedules and `minSessionCount` are enforced locally as well as on the server.
The cache is dropped when the user changes (`setUserId` / `clearUserId`).

## Delivery Tracking

Notifications are confirmed as `delivered` automatically: Web Push arrivals by
the service worker, and messages received over the real-time connection on an
open page by the SDK. No code needed.

The service worker also reports when a notification is `opened` (body clicked),
`clicked` (an action button clicked) or dismissed. Copy the latest
`service-worker.js` into your public directory to get these.

## Browser Support

- Chrome 50+ (Desktop & Android)
- Firefox 44+
- Edge 17+
- Safari 16+ on macOS
- Safari on iOS / iPadOS 16.4+, for web apps added to the Home Screen (not in a regular browser tab)
- Opera 37+

## Requirements

- HTTPS required (localhost works for development)
- Service worker file must be in the public root directory

## Example

See the [web_example](web_example/) directory for a complete interactive demo with all features.

The Push SDK works independently without VoIP.

## Links

- [Abrova Push](https://abrova.ir/cloud/abrova-push) - Learn more about Abrova Push
- [Documentation](https://abrova.ir/cloud/abrova-push/docs/quick-start) - Full documentation and guides
- [Abrova Console](https://console.abrova.ir) - Manage your push notifications

## License

MIT License - see [LICENSE](LICENSE) for details.
