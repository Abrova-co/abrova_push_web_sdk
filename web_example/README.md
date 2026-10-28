# AbrovaPush Web SDK Example

A comprehensive example app demonstrating all features of the AbrovaPush Web SDK for browser push notifications.

## Features Demonstrated

This example showcases all SDK capabilities:

### 1. Push Notifications
- Device registration with user ID
- Real-time MQTT-based message delivery
- Background notifications via Web Push API
- Notification actions handling
- Deep linking support

### 2. Topic Subscriptions
- Subscribe to custom topics
- Unsubscribe from topics
- Topic-based message targeting

### 3. Connection Management
- Real-time connection status
- Automatic reconnection with exponential backoff
- Network state monitoring
- App visibility state tracking

### 4. Badge Management
- Set, increment, decrement badge count
- Clear badge
- Favicon badge updates
- Browser Badge API support (where available)

### 5. Analytics
- SDK event tracking
- Custom analytics handler
- Enable/disable analytics

### 6. Logging
- Configurable log levels
- Real-time event log display

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- A modern browser with Push API support (Chrome, Firefox, Edge, Safari 16+)
- A AbrovaPush API key from the AbrovaConsole Console

### Setup

1. **Navigate to the example directory**
   ```bash
   cd /path/to/abrovapush_project/examples/web_example
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the development server**
   ```bash
   npm run dev
   ```

4. **Open in browser**

   The app will open at `http://localhost:3000`

5. **Configure and register**
   - Enter your AbrovaPush API key
   - Set the server URL (default: `https://api.abrovapush.io`)
   - Optionally set a user ID
   - Click "Register Device"

### Production Build

```bash
npm run build
npm run preview
```

## Project Structure

```
web_example/
├── index.html              # Main HTML file with UI
├── src/
│   └── main.ts            # TypeScript entry point with SDK integration
├── public/
│   └── abrovapush-sw.js      # Service worker for background notifications
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## SDK Integration Guide

### Initialization

```typescript
import AbrovaPush, { AbrovaPushLogLevel } from '@abrovapush/web-sdk';

const abrovapush = new AbrovaPush({
  apiKey: 'ab_live_your_api_key',
  serverUrl: 'https://api.abrovapush.io',
  logLevel: AbrovaPushLogLevel.DEBUG,
});
```

### Device Registration

```typescript
// Register device
const deviceId = await abrovapush.register({
  userId: 'user_123',  // Optional: for targeted notifications
});

console.log('Registered:', deviceId);
```

### Message Handling

```typescript
// Listen for messages
abrovapush.onMessage((message) => {
  console.log('Received:', message.title, message.body);
  console.log('Data:', message.data);
});

// Handle notification clicks
abrovapush.onNotificationClick((message, action) => {
  console.log('Clicked:', message.title);
  if (action) {
    console.log('Action:', action);
  }
});
```

### Topics

```typescript
// Subscribe to a topic
await abrovapush.subscribeTopic('news');

// Unsubscribe from a topic
await abrovapush.unsubscribeTopic('promotions');
```

### Connection Monitoring

```typescript
abrovapush.onConnectionState((state) => {
  console.log('Connection:', state); // 'connecting', 'connected', 'disconnected', 'error'
});

abrovapush.onReconnecting((state) => {
  console.log(`Retry ${state.retryAttempt}/${state.maxRetryAttempts}`);
  console.log(`Next retry in ${state.nextRetryMs}ms`);
});
```

### Network & App State

```typescript
// Get current network state
const network = abrovapush.getNetworkState();
console.log('Online:', network.isAvailable);
console.log('Type:', network.networkType);

// Listen for network changes
abrovapush.onNetworkState((state) => {
  console.log('Network changed:', state);
});

// Get app visibility state
const app = abrovapush.getAppState();
console.log('Visible:', app.isVisible);

// Listen for visibility changes
abrovapush.onAppState((state) => {
  console.log('Visibility:', state.visibilityState);
});
```

### Badge Management

```typescript
// Set badge count
abrovapush.setBadgeCount(5);

// Get current badge
const count = abrovapush.getBadgeCount();

// Clear badge
abrovapush.clearBadge();
```

### Analytics

```typescript
// Enable analytics with custom handler
abrovapush.setAnalyticsHandler((event, properties) => {
  // Send to your analytics service
  analytics.track(`abrovapush_${event}`, properties);
});

// Disable analytics
abrovapush.disableAnalytics();

// Check if enabled
const enabled = abrovapush.isAnalyticsEnabled();
```

### Error Handling

```typescript
abrovapush.onError((error) => {
  console.error('Error:', error.message);
});

abrovapush.onDetailedError((error) => {
  console.error('Code:', error.code);
  console.error('Message:', error.message);
  console.error('Details:', error.details);
});
```

### Logging

```typescript
import { AbrovaPushLogLevel } from '@abrovapush/web-sdk';

// Set log level
abrovapush.setLogLevel(AbrovaPushLogLevel.INFO);

// Available levels:
// - NONE (0): No logging
// - ERROR (1): Errors only
// - WARNING (2): Errors and warnings
// - INFO (3): Info, warnings, and errors
// - DEBUG (4): Debug and above (default)
// - VERBOSE (5): Everything
```

## Browser Support

| Browser | Version | Notes |
|---------|---------|-------|
| Chrome | 50+ | Full support |
| Firefox | 44+ | Full support |
| Edge | 17+ | Full support |
| Safari | 16+ | Web Push requires macOS Ventura+ |
| Opera | 42+ | Full support |

## Service Worker

The example includes a service worker (`public/abrovapush-sw.js`) that handles:
- Background push notifications
- Notification click events
- Action button clicks
- Deep linking

The service worker is automatically registered by the SDK when `autoRegisterServiceWorker` is true (default).

## HTTPS Requirement

Web Push requires HTTPS in production. For local development:
- `localhost` works without HTTPS
- Use a tool like [ngrok](https://ngrok.com) for testing on devices

## Related Documentation

- [AbrovaPush Web SDK](../../web/abrovapush-web/README.md) - SDK documentation
- [AbrovaConsole Console](https://console.abrovaconsole.io) - Manage your projects
- [AbrovaConsole Docs](https://docs.abrovaconsole.io) - Full documentation

## License

Copyright (c) AbrovaConsole. All rights reserved.
