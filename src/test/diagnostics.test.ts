/**
 * SDK self-reports: error counts by code, their reasons from a fixed list,
 * the two headers, caps, cleared only after a 2xx, and sendDiagnostics: false.
 */
import { jest } from '@jest/globals';
import {
  DIAGNOSTICS_STORAGE_KEY,
  MAX_REASONS_HEADER_LENGTH,
  REASONS_HEADER,
  REPORT_HEADER,
  SdkDiagnostics,
  classifyError,
  classifyRequestError,
  httpReason,
  isPushApiUrl,
  reasonEntry,
} from '../diagnostics';
import { PushApiClient, UserTokenManager } from '../user-token';
import { AbrovaPush, AbrovaPushErrorCode } from '../index';
import { sockets, PNState, PNError, PNSocket } from './__mocks__/pn-protocol';

const ONLINE = { onLine: true };
const API = 'https://push-api.abrova.ir';

/** Server grammar for one reasons entry, from the shared spec. */
const ENTRY = /^(\d{4}):([a-z][a-z0-9_]{0,19})(?:\.(\d{1,5}))?(?:\.(wifi|cellular|ethernet|vpn|none|other))?=(\d{1,4})$/;
const REPORT_ENTRY = /^\d{4}=\d{1,4}$/;

function memoryStorage() {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
    removeItem: (k: string) => {
      delete data[k];
    },
  };
}

/** A storage function over one new in-memory storage. */
function fresh() {
  const storage = memoryStorage();
  return () => storage;
}

function pnError(message: string, code = 100) {
  const e = new PNError(message);
  e.code = code;
  return e;
}

function named(name: string, extra: Record<string, unknown> = {}) {
  const e = new Error('secret host push.example.com:443 user=alice') as Error & Record<string, unknown>;
  e.name = name;
  Object.assign(e, extra);
  return e;
}

beforeEach(() => {
  localStorage.clear();
});

describe('classifyError', () => {
  it('maps browser error types to the fixed words', () => {
    expect(classifyError(named('TimeoutError'), ONLINE)).toBe('timeout');
    expect(classifyError(named('AbortError'), ONLINE)).toBe('cancelled');
    expect(classifyError(named('SecurityError'), ONLINE)).toBe('security');
    expect(classifyError(named('NotAllowedError'), ONLINE)).toBe('security');
    expect(classifyError(named('InvalidStateError'), ONLINE)).toBe('state');
    expect(classifyError(new SyntaxError('Unexpected token < in JSON'), ONLINE)).toBe('parse');
    expect(classifyError(new RangeError('bad'), ONLINE)).toBe('arg');
    expect(classifyError(new Error('anything'), ONLINE)).toBe('other');
    expect(classifyError(undefined, ONLINE)).toBe('other');
    expect(classifyError('a string', ONLINE)).toBe('other');
  });

  it('says offline when the browser is offline', () => {
    expect(classifyError(new Error('Failed to fetch'), { onLine: false })).toBe('offline');
    expect(classifyError(new TypeError('Failed to fetch'), { onLine: true })).toBe('other');
  });

  it('reads numeric codes: HTTP status, WebSocket close code, MQTT reason code', () => {
    expect(classifyError(named('HttpError', { status: 503 }), ONLINE)).toBe('http503');
    expect(classifyError(named('HttpError', { status: 200 }), ONLINE)).toBe('other');
    expect(classifyError({ type: 'close', code: 1006, wasClean: false, reason: 'x' }, ONLINE)).toBe('ws1006');
    expect(classifyError(named('ErrorWithReasonCode', { code: 135 }), ONLINE)).toBe('mqtt135');
    expect(httpReason(404)).toBe('http404');
    expect(httpReason(399)).toBeNull();
  });

  it('reads the MQTT code back from the fixed connack text of the connection library', () => {
    expect(classifyError(pnError('Connection refused: Not authorized'), ONLINE)).toBe('mqtt135');
    expect(classifyError(pnError('Connection refused: Server unavailable'), ONLINE)).toBe('mqtt136');
    expect(classifyError(pnError('Connection refused: Something new'), ONLINE)).toBe('other');
  });

  it("maps the connection library's own errors", () => {
    expect(classifyError(pnError('Connection timeout'), ONLINE)).toBe('timeout');
    expect(classifyError(pnError('connack timeout'), ONLINE)).toBe('timeout');
    expect(classifyError(pnError('whatever', 102), ONLINE)).toBe('timeout');
    expect(classifyError(pnError('Connection closed before the gateway accepted it'), ONLINE)).toBe('socket');
    expect(classifyError(pnError('lost', 101), ONLINE)).toBe('eof');
    expect(classifyError(pnError('bad', 501), ONLINE)).toBe('parse');
    // A PNError code is not an MQTT reason code.
    expect(classifyError(pnError('Connection failed', 100), ONLINE)).toBe('other');
  });

  it('never produces mqtt0: uses the cause under it', () => {
    const inner = named('TimeoutError');
    const outer = named('ErrorWithReasonCode', { code: 0, cause: inner });
    expect(classifyError(outer, ONLINE)).toBe('timeout');
    expect(classifyError(named('ErrorWithReasonCode', { code: 0 }), ONLINE)).toBe('other');
  });

  it('collects words along the cause chain and returns the highest priority one', () => {
    // timeout beats parse, wherever it is in the chain
    const chain = named('SyntaxError', { cause: named('InvalidStateError', { cause: named('TimeoutError') }) });
    expect(classifyError(chain, ONLINE)).toBe('timeout');
    // numeric codes beat everything
    expect(classifyError(named('TimeoutError', { cause: named('HttpError', { status: 502 }) }), ONLINE)).toBe('http502');
    // offline beats state, timeout beats offline
    expect(classifyError(named('InvalidStateError'), { onLine: false })).toBe('offline');
    expect(classifyError(named('TimeoutError'), { onLine: false })).toBe('timeout');
    // security beats cancelled
    expect(classifyError(named('AbortError', { cause: named('SecurityError') }), ONLINE)).toBe('security');
  });

  it('stops after 8 causes and on a cause loop', () => {
    let e: any = named('TimeoutError');
    for (let i = 0; i < 9; i++) e = { name: 'Error', message: '', cause: e };
    expect(classifyError(e, ONLINE)).toBe('other');
    const loop: any = { name: 'Error', message: '' };
    loop.cause = loop;
    expect(classifyError(loop, ONLINE)).toBe('other');
  });

  it('never throws on hostile input', () => {
    const hostile = new Proxy({}, { get: () => { throw new Error('boom'); } });
    expect(classifyError(hostile, ONLINE)).toBe('other');
  });

  it('never returns any text of the error', () => {
    const words = new Set([
      'timeout', 'dns', 'refused', 'noroute', 'offline', 'reset', 'eof', 'socket', 'tls_handshake', 'cert', 'tls',
      'parse', 'state', 'arg', 'security', 'oom', 'cancelled', 'other',
    ]);
    const samples: unknown[] = [
      named('Error'), named('TypeError'), pnError('Connection refused: push.example.com'), named('HttpError', { status: 500 }),
      { type: 'close', code: 4001, wasClean: true }, named('ErrorWithReasonCode', { code: 5 }),
    ];
    for (const sample of samples) {
      const reason = classifyError(sample, ONLINE);
      expect(words.has(reason) || /^(mqtt\d{1,5}|http\d{3}|ws\d{4})$/.test(reason)).toBe(true);
    }
  });

  it('a failed fetch without a better reason is a socket error', () => {
    expect(classifyRequestError(new TypeError('Failed to fetch'), ONLINE)).toBe('socket');
    expect(classifyRequestError(new TypeError('Failed to fetch'), { onLine: false })).toBe('offline');
    expect(classifyRequestError(named('AbortError'), ONLINE)).toBe('cancelled');
  });
});

describe('SdkDiagnostics counts and headers', () => {
  it('counts by code and reason and builds both headers', () => {
    const d = new SdkDiagnostics(true, fresh());
    d.count(1000, 'timeout', 443);
    d.count(1000, 'timeout', 443);
    d.count(1000, 'mqtt135', 443);
    d.count(1402, 'http503');
    d.count(1600);
    const report = d.report()!;
    expect(report.headers[REPORT_HEADER]).toBe('1000=3 1402=1 1600=1');
    expect(report.headers[REASONS_HEADER]).toBe('1000:mqtt135.443=1 1000:timeout.443=2 1402:http503=1');
    for (const part of report.headers[REPORT_HEADER].split(' ')) expect(part).toMatch(REPORT_ENTRY);
    for (const part of report.headers[REASONS_HEADER].split(' ')) expect(part).toMatch(ENTRY);
  });

  it('sends nothing when nothing was counted', () => {
    expect(new SdkDiagnostics(true, fresh()).report()).toBeNull();
  });

  it('keeps counts in localStorage, so a new page load sends them', () => {
    new SdkDiagnostics(true).count(1003, 'refused', 8883);
    expect(localStorage.getItem(DIAGNOSTICS_STORAGE_KEY)).toBeTruthy();
    expect(new SdkDiagnostics(true).report()!.headers[REASONS_HEADER]).toBe('1003:refused.8883=1');
  });

  it('falls back to memory when storage is blocked', () => {
    const blocked = () => {
      throw new Error('SecurityError');
    };
    const d = new SdkDiagnostics(true, blocked as any);
    d.count(1001, 'timeout');
    expect(d.report()!.headers[REPORT_HEADER]).toBe('1001=1');
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    const d2 = new SdkDiagnostics(true, () => full);
    d2.count(1001, 'timeout');
    d2.count(1001, 'timeout');
    expect(d2.report()!.headers[REPORT_HEADER]).toBe('1001=2');
  });

  it('subtracts only what was sent; counts added meanwhile stay', () => {
    const d = new SdkDiagnostics(true, fresh());
    d.count(1000, 'timeout', 443);
    const report = d.report()!;
    d.count(1000, 'timeout', 443);
    d.count(1400, 'http500');
    d.acknowledge(report.sent);
    const next = d.report()!;
    expect(next.headers[REPORT_HEADER]).toBe('1000=1 1400=1');
    expect(next.headers[REASONS_HEADER]).toBe('1000:timeout.443=1 1400:http500=1');
    d.acknowledge(next.sent);
    expect(d.report()).toBeNull();
  });

  it('caps a count at 9999', () => {
    const storage = memoryStorage();
    storage.setItem(DIAGNOSTICS_STORAGE_KEY, JSON.stringify({ c: { '1000': 9998 }, r: { '1000:timeout': 9999 } }));
    const d = new SdkDiagnostics(true, () => storage);
    d.count(1000, 'timeout');
    d.count(1000, 'timeout');
    const report = d.report()!;
    expect(report.headers[REPORT_HEADER]).toBe('1000=9999');
    expect(report.headers[REASONS_HEADER]).toBe('1000:timeout=9999');
  });

  it('keeps at most 16 codes', () => {
    const d = new SdkDiagnostics(true, fresh());
    for (let i = 0; i < 17; i++) d.count(1000 + i, 'other');
    const report = d.report()!;
    expect(report.headers[REPORT_HEADER].split(' ')).toHaveLength(16);
    expect(report.headers[REPORT_HEADER]).not.toContain('1016=');
    expect(report.headers[REASONS_HEADER]).not.toContain('1016:');
  });

  it('a 17th distinct reason is not kept, but its code is still counted', () => {
    const d = new SdkDiagnostics(true, fresh());
    for (let i = 0; i < 16; i++) d.count(1000, 'timeout', 1000 + i);
    d.count(1000, 'refused', 443);
    d.count(1000, 'timeout', 1000); // an entry already kept still counts up
    const report = d.report()!;
    expect(report.headers[REPORT_HEADER]).toBe('1000=18');
    const parts = report.headers[REASONS_HEADER].split(' ');
    expect(parts).toHaveLength(16);
    expect(report.headers[REASONS_HEADER]).not.toContain('refused');
    expect(parts).toContain('1000:timeout.1000=2');
  });

  it('keeps the reasons header within 400 characters; the rest waits for a later request', () => {
    const d = new SdkDiagnostics(true, fresh());
    for (let i = 0; i < 16; i++) d.count(1000 + i, 'tls_handshake', 65000 + i);
    for (let i = 0; i < 16; i++) for (let n = 0; n < 9; n++) d.count(1000 + i, 'tls_handshake', 65000 + i);
    const report = d.report()!;
    const value = report.headers[REASONS_HEADER];
    expect(value.length).toBeLessThanOrEqual(MAX_REASONS_HEADER_LENGTH);
    const sentEntries = Object.keys(report.sent.reasons);
    expect(sentEntries.length).toBeLessThan(16);
    d.acknowledge(report.sent);
    const next = d.report()!;
    // The codes were sent; the reasons that did not fit go with the next request.
    expect(next.headers[REPORT_HEADER]).toBeUndefined();
    expect(Object.keys(next.sent.reasons).length).toBe(16 - sentEntries.length);
    d.acknowledge(next.sent);
    expect(d.report()).toBeNull();
  });

  it('drops a reason that does not match the server grammar, still counting the code', () => {
    const d = new SdkDiagnostics(true, fresh());
    d.count(1000, 'Not A Word');
    d.count(1000, 'x'.repeat(30));
    const report = d.report()!;
    expect(report.headers[REPORT_HEADER]).toBe('1000=2');
    expect(report.headers[REASONS_HEADER]).toBeUndefined();
    expect(reasonEntry(1000, 'timeout', 70000)).toBe('1000:timeout');
  });

  it('ignores stored data it did not write', () => {
    const storage = memoryStorage();
    storage.setItem(
      DIAGNOSTICS_STORAGE_KEY,
      JSON.stringify({ c: { '1000': 2, hello: 3, '1001': -1 }, r: { '1000:timeout': 1, '1000:Bad Text=1': 4 } }),
    );
    const report = new SdkDiagnostics(true, () => storage).report()!;
    expect(report.headers[REPORT_HEADER]).toBe('1000=2');
    expect(report.headers[REASONS_HEADER]).toBe('1000:timeout=1');
  });

  it('disabled: nothing counted, kept or sent, and old counts are removed', () => {
    const storage = memoryStorage();
    new SdkDiagnostics(true, () => storage).count(1000, 'timeout');
    expect(storage.data[DIAGNOSTICS_STORAGE_KEY]).toBeTruthy();
    const d = new SdkDiagnostics(false, () => storage);
    expect(storage.data[DIAGNOSTICS_STORAGE_KEY]).toBeUndefined();
    d.count(1000, 'timeout');
    expect(storage.data[DIAGNOSTICS_STORAGE_KEY]).toBeUndefined();
    expect(d.report()).toBeNull();
  });
});

describe('PushApiClient sends the report', () => {
  const originalFetch = (global as any).fetch;
  afterEach(() => {
    (global as any).fetch = originalFetch;
  });

  function setup(status: number) {
    const d = new SdkDiagnostics(true, fresh());
    d.count(1000, 'timeout', 443);
    const fetchMock = jest.fn<(...args: any[]) => Promise<any>>(async () => ({ ok: status >= 200 && status < 300, status }));
    (global as any).fetch = fetchMock;
    const client = new PushApiClient(new UserTokenManager(), () => undefined, d, (url) => isPushApiUrl(url, API));
    return { d, fetchMock, client };
  }

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('adds both headers to a Push API request and clears them after a 2xx', async () => {
    const { d, fetchMock, client } = setup(200);
    await client.fetch(`${API}/devices/config`, { headers: { 'x-api-key': 'k' } });
    await flush();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual({
      'x-api-key': 'k',
      [REPORT_HEADER]: '1000=1',
      [REASONS_HEADER]: '1000:timeout.443=1',
    });
    expect(d.report()).toBeNull();
    await client.fetch(`${API}/devices/config`, { headers: { 'x-api-key': 'k' } });
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toEqual({ 'x-api-key': 'k' });
  });

  it('keeps the counts when the server did not answer 2xx', async () => {
    const { d, client } = setup(500);
    await client.fetch(`${API}/devices/register`, {});
    await flush();
    expect(d.report()!.headers[REPORT_HEADER]).toBe('1000=1');
  });

  it('keeps the counts when the request failed', async () => {
    const { d, client } = setup(200);
    (global as any).fetch = jest.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(client.fetch(`${API}/devices/register`, {})).rejects.toThrow('Failed to fetch');
    await flush();
    expect(d.report()!.headers[REPORT_HEADER]).toBe('1000=1');
  });

  it('never sends the report to another host', async () => {
    const { d, fetchMock, client } = setup(200);
    await client.fetch('https://example.com/devices/config', { headers: { a: 'b' } });
    await client.fetch('https://push-api.abrova.ir.evil.example/x', { headers: { a: 'b' } });
    await flush();
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toEqual({ a: 'b' });
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toEqual({ a: 'b' });
    expect(d.report()).not.toBeNull();
  });

  it('keeps Headers objects given by the caller', async () => {
    const { fetchMock, client } = setup(200);
    await client.fetch(`${API}/x`, { headers: new Headers({ 'x-api-key': 'k' }) });
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('k');
    expect(headers[REPORT_HEADER]).toBe('1000=1');
  });
});

describe('AbrovaPush counts its errors', () => {
  const API_KEY = 'ab_live_your_api_key';
  const originalFetch = (global as any).fetch;

  function client(config: Record<string, unknown> = {}): any {
    (global as any).fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    const c: any = new AbrovaPush({ apiKey: API_KEY, ...config });
    c.mqttConfig = { host: 'mqtt.example', wsHost: 'ws.example', port: 8883, wsPort: 443, token: 'tok-1' };
    c.mqttConfigFetched = true;
    c.appId = 'app16chars000000';
    c.deviceId = 'web_device';
    return c;
  }

  beforeEach(() => {
    sockets.length = 0;
  });

  afterEach(() => {
    (global as any).fetch = originalFetch;
  });

  it('a gateway error is counted with its reason and port', async () => {
    const c = client();
    c.connectToGateway();
    await Promise.resolve();
    sockets[0].simulateError('Connection timeout');
    const report = c.diagnostics.report();
    expect(report.headers[REPORT_HEADER]).toBe('1001=1');
    expect(report.headers[REASONS_HEADER]).toBe('1001:timeout.443=1');
    c.disconnectFromGateway();
  });

  it('a connection that fails while it is set up reports 1007', async () => {
    const c = client();
    const errors: number[] = [];
    c.onError((e: any) => errors.push(e.code));
    c.connectToGateway();
    await Promise.resolve();
    // The library starts an attempt and fails it in the same task (creating the client threw).
    const socket = sockets[0];
    socket.setState(PNState.CONNECTING);
    socket.setState(PNState.DISCONNECTED);
    socket.simulateError('Invalid URL');
    expect(errors).toEqual([AbrovaPushErrorCode.CONNECTION_SETUP_FAILED]);
    expect(c.diagnostics.report().headers[REPORT_HEADER]).toBe('1007=1');
    expect(AbrovaPushErrorCode.CONNECTION_SETUP_FAILED).toBe(1007);
    c.disconnectFromGateway();
  });

  it('a socket that cannot be created reports 1007', async () => {
    const c = client();
    const errors: number[] = [];
    c.onError((e: any) => errors.push(e.code));
    // open() throwing stands for any failure while the connection is prepared
    const spy = jest.spyOn(PNSocket.prototype, 'open').mockImplementation(() => {
      throw new Error('cannot create client');
    });
    c.connectToGateway();
    spy.mockRestore();
    expect(errors).toEqual([AbrovaPushErrorCode.CONNECTION_SETUP_FAILED]);
    expect(c.diagnostics.report().headers[REASONS_HEADER]).toBe('1007:other.443=1');
    expect(c.pnSocket).toBeNull();
  });

  it('a later network error is not 1007', async () => {
    const c = client();
    const errors: number[] = [];
    c.onError((e: any) => errors.push(e.code));
    c.connectToGateway();
    await Promise.resolve();
    sockets[0].setState(PNState.DISCONNECTED);
    sockets[0].simulateError('Connection closed before the gateway accepted it');
    expect(errors).toEqual([AbrovaPushErrorCode.CONNECTION_FAILED]);
    expect(c.diagnostics.report().headers[REASONS_HEADER]).toBe('1000:socket.443=1');
    c.disconnectFromGateway();
  });

  it('a register answered with an HTTP error is counted as http<status>', async () => {
    const c = client();
    (global as any).fetch = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    await expect(c.registerDevice({})).rejects.toMatchObject({ code: AbrovaPushErrorCode.SERVER_ERROR });
    expect(c.diagnostics.report().headers[REASONS_HEADER]).toBe('1402:http503=1');
  });

  it('sendDiagnostics: false counts, keeps and sends nothing', async () => {
    localStorage.setItem(DIAGNOSTICS_STORAGE_KEY, JSON.stringify({ c: { '1000': 1 }, r: {} }));
    const c = client({ sendDiagnostics: false });
    expect(localStorage.getItem(DIAGNOSTICS_STORAGE_KEY)).toBeNull();
    c.connectToGateway();
    await Promise.resolve();
    sockets[0].simulateError('Connection timeout');
    expect(localStorage.getItem(DIAGNOSTICS_STORAGE_KEY)).toBeNull();
    const fetchMock = jest.fn<(...args: any[]) => Promise<any>>(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    (global as any).fetch = fetchMock;
    await c.authedFetch(`${API}/devices/config`, { headers: { 'x-api-key': API_KEY } });
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toEqual({ 'x-api-key': API_KEY });
    c.disconnectFromGateway();
  });
});
