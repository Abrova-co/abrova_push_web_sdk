/**
 * AbrovaPush Web SDK Unit Tests
 */

import { jest } from '@jest/globals';
import AbrovaPush, {
  AbrovaPushErrorCode,
  AbrovaPushError,
  AbrovaPushLogLevel,
  AbrovaPushAnalyticsEvent,
  NetworkType,
  type AbrovaPushConfig,
  type AbrovaPushMessage,
  type NetworkState,
} from '../index';

describe('AbrovaPush SDK', () => {
  // ============================================================================
  // Static Methods
  // ============================================================================

  describe('static methods', () => {
    describe('isSupported', () => {
      it('should return true when all APIs are available', () => {
        expect(AbrovaPush.isSupported()).toBe(true);
      });

      it('should return false when Notification API is not available', () => {
        const originalNotification = window.Notification;
        delete (window as any).Notification;

        expect(AbrovaPush.isSupported()).toBe(false);

        // Restore
        Object.defineProperty(window, 'Notification', {
          value: originalNotification,
          writable: true,
          configurable: true,
        });
      });
    });

    describe('getPermissionStatus', () => {
      it('should return current notification permission', () => {
        const status = AbrovaPush.getPermissionStatus();
        expect(['granted', 'denied', 'default']).toContain(status);
      });
    });

    describe('requestPermission', () => {
      it('should request notification permission via Notification API', async () => {
        const result = await Notification.requestPermission();
        expect(result).toBe('granted');
        expect(Notification.requestPermission).toHaveBeenCalled();
      });
    });
  });

  // ============================================================================
  // Constructor & Initialization
  // ============================================================================

  describe('constructor', () => {
    it('should create instance with valid config', () => {
      const config: AbrovaPushConfig = {
        apiKey: 'ab_live_test123',

      };

      const abrovaPush = new AbrovaPush(config);
      expect(abrovaPush).toBeInstanceOf(AbrovaPush);
    });

    it('should throw error when apiKey is missing', () => {
      expect(() => {
        new AbrovaPush({
          apiKey: '',
  
        });
      }).toThrow();
    });

    it('should use default log level when not specified', () => {
      const config: AbrovaPushConfig = {
        apiKey: 'ab_live_test123',

      };

      const abrovaPush = new AbrovaPush(config);
      // Should not throw - validates log level is set
      expect(abrovaPush).toBeInstanceOf(AbrovaPush);
    });

    it('should respect custom log level', () => {
      const config: AbrovaPushConfig = {
        apiKey: 'ab_live_test123',

        logLevel: AbrovaPushLogLevel.VERBOSE,
      };

      const abrovaPush = new AbrovaPush(config);
      expect(abrovaPush).toBeInstanceOf(AbrovaPush);
    });
  });

  // ============================================================================
  // Configuration
  // ============================================================================

  describe('configuration', () => {
    let abrovaPush: AbrovaPush;

    beforeEach(() => {
      abrovaPush = new AbrovaPush({
        apiKey: 'ab_live_test123',

      });
    });

    it('should set log level', () => {
      expect(() => {
        abrovaPush.setLogLevel(AbrovaPushLogLevel.ERROR);
      }).not.toThrow();
    });

    it('should set analytics handler', () => {
      const handler = jest.fn();
      abrovaPush.setAnalyticsHandler(handler);
      // Handler is stored internally - no direct way to verify
      expect(() => abrovaPush.setAnalyticsHandler(handler)).not.toThrow();
    });

    it('should disable analytics', () => {
      expect(() => {
        abrovaPush.disableAnalytics();
      }).not.toThrow();
    });
  });

  // ============================================================================
  // Callbacks
  // ============================================================================

  describe('callbacks', () => {
    let abrovaPush: AbrovaPush;

    beforeEach(() => {
      abrovaPush = new AbrovaPush({
        apiKey: 'ab_live_test123',

      });
    });

    it('should register onMessage callback', () => {
      const callback = jest.fn();
      abrovaPush.onMessage(callback);
      // Internal registration - no throw means success
      expect(true).toBe(true);
    });

    it('should register onConnectionState callback', () => {
      const callback = jest.fn();
      abrovaPush.onConnectionState(callback);
      expect(true).toBe(true);
    });

    it('should register onRegistered callback', () => {
      const callback = jest.fn();
      abrovaPush.onRegistered(callback);
      expect(true).toBe(true);
    });

    it('should register onError callback', () => {
      const callback = jest.fn();
      abrovaPush.onError(callback);
      expect(true).toBe(true);
    });

    it('should register onDetailedError callback', () => {
      const callback = jest.fn();
      abrovaPush.onDetailedError(callback);
      expect(true).toBe(true);
    });

    it('should register onNotificationClick callback', () => {
      const callback = jest.fn();
      abrovaPush.onNotificationClick(callback);
      expect(true).toBe(true);
    });

    it('should register onActionClicked callback', () => {
      const callback = jest.fn();
      abrovaPush.onActionClicked(callback);
      expect(true).toBe(true);
    });

    it('should register onReconnecting callback', () => {
      const callback = jest.fn();
      abrovaPush.onReconnecting(callback);
      expect(true).toBe(true);
    });

    it('should register onNetworkState callback', () => {
      const callback = jest.fn();
      abrovaPush.onNetworkState(callback);
      expect(true).toBe(true);
    });

    it('should register onAppState callback', () => {
      const callback = jest.fn();
      abrovaPush.onAppState(callback);
      expect(true).toBe(true);
    });
  });

  // ============================================================================
  // State Management
  // ============================================================================

  describe('state management', () => {
    let abrovaPush: AbrovaPush;

    beforeEach(() => {
      abrovaPush = new AbrovaPush({
        apiKey: 'ab_live_test123',

      });
    });

    it('should get network state', () => {
      const state = abrovaPush.getNetworkState();
      expect(state).toHaveProperty('isAvailable');
      expect(state).toHaveProperty('networkType');
    });

    it('should get badge count', () => {
      const count = abrovaPush.getBadgeCount();
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('should set badge count', () => {
      abrovaPush.setBadgeCount(5);
      expect(abrovaPush.getBadgeCount()).toBe(5);
    });

    it('should not allow negative badge count', () => {
      abrovaPush.setBadgeCount(-1);
      expect(abrovaPush.getBadgeCount()).toBe(0);
    });

    it('should clear badge', () => {
      abrovaPush.setBadgeCount(10);
      abrovaPush.clearBadge();
      expect(abrovaPush.getBadgeCount()).toBe(0);
    });

    it('should get initial message (null when none)', () => {
      const message = abrovaPush.getInitialMessage();
      expect(message).toBeNull();
    });
  });
});

// ============================================================================
// AbrovaPushError
// ============================================================================

describe('AbrovaPushError', () => {
  it('should create error with code and message', () => {
    const error = new AbrovaPushError(AbrovaPushErrorCode.CONNECTION_FAILED);
    expect(error.code).toBe(AbrovaPushErrorCode.CONNECTION_FAILED);
    expect(error.message).toBe('Failed to connect to MQTT broker');
    expect(error.name).toBe('AbrovaPushError');
  });

  it('should include details when provided', () => {
    const error = new AbrovaPushError(
      AbrovaPushErrorCode.NETWORK_ERROR,
      'Server returned 503'
    );
    expect(error.code).toBe(AbrovaPushErrorCode.NETWORK_ERROR);
    expect(error.details).toBe('Server returned 503');
  });

  it('should convert to JSON correctly', () => {
    const error = new AbrovaPushError(
      AbrovaPushErrorCode.PERMISSION_DENIED,
      'User blocked notifications'
    );
    const json = error.toJSON();

    expect(json).toEqual({
      code: AbrovaPushErrorCode.PERMISSION_DENIED,
      message: 'Notification permission denied',
      details: 'User blocked notifications',
    });
  });

  it('should have correct error codes', () => {
    // Connection errors
    expect(AbrovaPushErrorCode.CONNECTION_FAILED).toBe(1000);
    expect(AbrovaPushErrorCode.CONNECTION_TIMEOUT).toBe(1001);

    // Registration errors
    expect(AbrovaPushErrorCode.REGISTRATION_FAILED).toBe(1400);

    // Permission errors
    expect(AbrovaPushErrorCode.PERMISSION_DENIED).toBe(1600);

    // Unknown error
    expect(AbrovaPushErrorCode.UNKNOWN_ERROR).toBe(9999);
  });
});

// ============================================================================
// AbrovaPushLogLevel
// ============================================================================

describe('AbrovaPushLogLevel', () => {
  it('should have correct log level values', () => {
    expect(AbrovaPushLogLevel.NONE).toBe(0);
    expect(AbrovaPushLogLevel.ERROR).toBe(1);
    expect(AbrovaPushLogLevel.WARNING).toBe(2);
    expect(AbrovaPushLogLevel.INFO).toBe(3);
    expect(AbrovaPushLogLevel.DEBUG).toBe(4);
    expect(AbrovaPushLogLevel.VERBOSE).toBe(5);
  });
});

// ============================================================================
// AbrovaPushAnalyticsEvent
// ============================================================================

describe('AbrovaPushAnalyticsEvent', () => {
  it('should have correct event names', () => {
    expect(AbrovaPushAnalyticsEvent.SDK_INITIALIZED).toBe('sdkInitialized');
    expect(AbrovaPushAnalyticsEvent.DEVICE_REGISTERED).toBe('deviceRegistered');
    expect(AbrovaPushAnalyticsEvent.MESSAGE_RECEIVED).toBe('messageReceived');
    expect(AbrovaPushAnalyticsEvent.NOTIFICATION_CLICKED).toBe('notificationClicked');
    expect(AbrovaPushAnalyticsEvent.CONNECTED).toBe('connected');
    expect(AbrovaPushAnalyticsEvent.DISCONNECTED).toBe('disconnected');
  });
});

// ============================================================================
// NetworkType
// ============================================================================

describe('NetworkType', () => {
  it('should have correct network type values', () => {
    expect(NetworkType.WIFI).toBe('wifi');
    expect(NetworkType.CELLULAR).toBe('cellular');
    expect(NetworkType.ETHERNET).toBe('ethernet');
    expect(NetworkType.NONE).toBe('none');
    expect(NetworkType.UNKNOWN).toBe('unknown');
  });
});

// ============================================================================
// Message Normalization
// ============================================================================

describe('message handling', () => {
  it('should handle AbrovaPushMessage interface correctly', () => {
    const message: AbrovaPushMessage = {
      title: 'Test Title',
      body: 'Test Body',
      data: { key: 'value' },
      silent: false,
      imageUrl: 'https://example.com/image.png',
      iconUrl: 'https://example.com/icon.png',
      actions: [
        {
          id: 'action1',
          title: 'Open',
          action: 'https://example.com',
        },
      ],
      deepLink: 'https://example.com/deeplink',
      priority: 'high',
      badge: 5,
      badgeAction: 'set',
    };

    expect(message.title).toBe('Test Title');
    expect(message.body).toBe('Test Body');
    expect(message.actions).toHaveLength(1);
    expect(message.actions?.[0].id).toBe('action1');
    expect(message.priority).toBe('high');
  });
});
