/**
 * SDK self-reports. The SDK counts its own errors by the public error code
 * every Abrova Push SDK shares, and sends the counts with its next ordinary
 * Push API request:
 *
 *     X-Abrova-SDK-Report: 1000=3 1400=1
 *     X-Abrova-SDK-Report-Reasons: 1000:timeout.443=2 1000:mqtt135.443=1 1400:http503=1
 *
 * The reason is one word from a fixed list, chosen from the error's type and
 * numeric codes. Never a message, address, user, device or app value. A count
 * is cleared only after the server answered 2xx, so nothing is lost while
 * offline and nothing is counted twice. Switched off with
 * `sendDiagnostics: false`: then nothing is counted, kept or sent.
 *
 * Kept free of SDK state so it can be unit tested. Not part of the public API.
 */

export const REPORT_HEADER = 'X-Abrova-SDK-Report';
export const REASONS_HEADER = 'X-Abrova-SDK-Report-Reasons';

/** Most codes, most reason entries and highest count per report (the server accepts no more). */
export const MAX_CODES = 16;
export const MAX_REASONS = 16;
export const MAX_COUNT = 9999;
/** Longest reasons header the server accepts. */
export const MAX_REASONS_HEADER_LENGTH = 400;

export const DIAGNOSTICS_STORAGE_KEY = 'abrova_push_diagnostics';

/** One entry of the reasons header, without the count: `<code>:<reason>[.<port>][.<net>]`. */
const REASON_ENTRY = /^(\d{4}):([a-z][a-z0-9_]{0,19})(?:\.(\d{1,5}))?(?:\.(wifi|cellular|ethernet|vpn|none|other))?$/;

// ============================================================================
// Classifier
// ============================================================================

/** Fixed reason words (besides mqtt<N>, http<NNN> and ws<NNNN>), highest priority first. */
const PRIORITY = [
  'cert',
  'tls_handshake',
  'tls',
  'timeout',
  'dns',
  'refused',
  'noroute',
  'offline',
  'reset',
  'eof',
  'socket',
  'parse',
  'state',
  'arg',
  'security',
  'oom',
  'cancelled',
] as const;

/** Deepest cause the classifier looks at. */
const MAX_CAUSE_DEPTH = 8;

/**
 * MQTT 5 CONNACK reason codes, by the fixed text MQTT.js puts after
 * "Connection refused: ". The real-time connection hands the SDK MQTT.js
 * errors as text only, so the code is read back from this table.
 */
const MQTT5_CONNACK_CODES: Record<string, number> = {
  'unspecified error': 128,
  'malformed packet': 129,
  'protocol error': 130,
  'implementation specific error': 131,
  'unsupported protocol version': 132,
  'client identifier not valid': 133,
  'bad user name or password': 134,
  'not authorized': 135,
  'server unavailable': 136,
  'server busy': 137,
  'banned': 138,
  'server shutting down': 139,
  'bad authentication method': 140,
  'keep alive timeout': 141,
  'session taken over': 142,
  'packet too large': 149,
  'quota exceeded': 151,
  'administrative action': 152,
  'payload format invalid': 153,
  'retain not supported': 154,
  'qos not supported': 155,
  'use another server': 156,
  'server moved': 157,
  'connection rate exceeded': 159,
  'maximum connect time': 160,
};

/** Fixed messages of the connection library that name a timeout. */
const LIBRARY_TIMEOUT_MESSAGES = new Set(['connection timeout', 'connack timeout', 'keepalive timeout']);

/** Fixed message of the connection library for a socket closed before the gateway answered. */
const LIBRARY_CLOSED_EARLY = 'connection closed before the gateway accepted it';

/** Connection library error codes (PNErrorCode). */
const PN_CONNECTION_LOST = 101;
const PN_CONNECTION_TIMEOUT = 102;
const PN_INVALID_CONFIG = 500;
const PN_INVALID_MESSAGE = 501;

/** `http<status>` for an answer with status >= 400, else null. */
export function httpReason(status: unknown): string | null {
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599 ? `http${status}` : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function stringField(value: Record<string, unknown>, key: string): string {
  try {
    const v = value[key];
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
}

/** The numeric words (mqtt<N>, http<NNN>, ws<NNNN>) and fixed words one error object matches. */
function wordsOf(error: Record<string, unknown>, numeric: string[], words: Set<string>): void {
  const name = stringField(error, 'name');
  const message = stringField(error, 'message').trim().toLowerCase();
  const code = error.code;

  // WebSocket close event.
  const isClose =
    (typeof CloseEvent !== 'undefined' && error instanceof CloseEvent) ||
    (error.type === 'close' && typeof error.wasClean === 'boolean');
  if (isClose) {
    if (typeof code === 'number' && Number.isInteger(code) && code >= 1000 && code <= 4999) numeric.push(`ws${code}`);
    return;
  }

  // An HTTP answer.
  const isResponse = typeof Response !== 'undefined' && error instanceof Response;
  if (isResponse || name === 'HttpError') {
    const http = httpReason(error.status);
    if (http) numeric.push(http);
    return;
  }

  // DOMException and friends: classified by name.
  switch (name) {
    case 'TimeoutError':
      words.add('timeout');
      return;
    case 'AbortError':
      words.add('cancelled');
      return;
    case 'SecurityError':
    case 'NotAllowedError':
      words.add('security');
      return;
    case 'InvalidStateError':
      words.add('state');
      return;
    case 'SyntaxError':
      words.add('parse');
      return;
    case 'RangeError':
      words.add('arg');
      return;
  }

  // The connection library's own error: its code is not an MQTT reason code.
  if (name === 'PNError') {
    if (code === PN_CONNECTION_TIMEOUT || LIBRARY_TIMEOUT_MESSAGES.has(message)) words.add('timeout');
    else if (code === PN_CONNECTION_LOST) words.add('eof');
    else if (code === PN_INVALID_MESSAGE) words.add('parse');
    else if (code === PN_INVALID_CONFIG) words.add('arg');
    else if (message === LIBRARY_CLOSED_EARLY) words.add('socket');
    const refused = /^connection refused: (.+)$/.exec(message);
    if (refused) {
      const mqtt = MQTT5_CONNACK_CODES[refused[1]];
      if (mqtt) numeric.push(`mqtt${mqtt}`);
    }
    return;
  }

  // An MQTT.js error with a reason code. 0 only means "client-side": use the cause under it.
  if (name === 'ErrorWithReasonCode' && typeof code === 'number' && Number.isInteger(code)) {
    if (code > 0 && code <= 65535) numeric.push(`mqtt${code}`);
    return;
  }

  // Fixed MQTT.js messages (a plain Error).
  if (LIBRARY_TIMEOUT_MESSAGES.has(message)) words.add('timeout');
}

function causeOf(error: Record<string, unknown>): unknown {
  try {
    return error.cause;
  } catch {
    return undefined;
  }
}

function isOffline(nav: unknown): boolean {
  try {
    return isRecord(nav) && nav.onLine === false;
  } catch {
    return false;
  }
}

/**
 * One reason word from the fixed list for an error. Walks the cause chain (up
 * to 8 levels), collects every word that matches anywhere and returns the one
 * with the highest priority: mqtt<N> / http<NNN> / ws<NNNN>, then cert,
 * tls_handshake, tls, timeout, dns, refused, noroute, offline, reset, eof,
 * socket, parse, state, arg, security, oom, cancelled, else `other`.
 *
 * Only the error's type, name and numeric codes are read (and the fixed
 * messages of the connection libraries the SDK uses). No text of the error
 * ever ends up in the result. Never throws.
 */
export function classifyError(
  error: unknown,
  nav: unknown = typeof navigator !== 'undefined' ? navigator : undefined,
): string {
  try {
    const numeric: string[] = [];
    const words = new Set<string>();
    let current: unknown = error;
    const seen = new Set<unknown>();
    for (let depth = 0; depth <= MAX_CAUSE_DEPTH && isRecord(current) && !seen.has(current); depth++) {
      seen.add(current);
      wordsOf(current, numeric, words);
      current = causeOf(current);
    }
    if (isOffline(nav)) words.add('offline');
    if (numeric.length > 0) return numeric[0];
    for (const word of PRIORITY) if (words.has(word)) return word;
    return 'other';
  } catch {
    return 'other';
  }
}

/**
 * Reason of a failed Push API request: as classifyError, and a fetch that
 * rejected with a TypeError (the browser hides why) counts as `socket`.
 */
export function classifyRequestError(
  error: unknown,
  nav: unknown = typeof navigator !== 'undefined' ? navigator : undefined,
): string {
  const reason = classifyError(error, nav);
  if (reason === 'other' && isRecord(error) && stringField(error, 'name') === 'TypeError') return 'socket';
  return reason;
}

// ============================================================================
// Counts
// ============================================================================

interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** code -> count, and `<code>:<reason>[.<port>]` -> count. */
export interface DiagnosticsCounts {
  codes: Record<string, number>;
  reasons: Record<string, number>;
}

/** What one request carries, and what to subtract once the server took it. */
export interface DiagnosticsReport {
  headers: Record<string, string>;
  sent: DiagnosticsCounts;
}

function emptyCounts(): DiagnosticsCounts {
  return { codes: {}, reasons: {} };
}

function cleanMap(value: unknown, valid: (key: string) => boolean): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(value)) return out;
  for (const [key, n] of Object.entries(value)) {
    if (valid(key) && typeof n === 'number' && Number.isInteger(n) && n > 0) out[key] = Math.min(n, MAX_COUNT);
  }
  return out;
}

const isCodeKey = (key: string) => /^\d{4}$/.test(key);
const isReasonKey = (key: string) => REASON_ENTRY.test(key);

function parseCounts(raw: string | null | undefined): DiagnosticsCounts {
  if (!raw) return emptyCounts();
  try {
    const value = JSON.parse(raw);
    if (!isRecord(value)) return emptyCounts();
    return { codes: cleanMap(value.c, isCodeKey), reasons: cleanMap(value.r, isReasonKey) };
  } catch {
    return emptyCounts();
  }
}

const byCodeThenKey = (a: string, b: string) => {
  const ca = parseInt(a.slice(0, 4), 10);
  const cb = parseInt(b.slice(0, 4), 10);
  return ca !== cb ? ca - cb : a < b ? -1 : a > b ? 1 : 0;
};

/** `<code>:<reason>[.<port>]`, or null when it would not match the server's grammar. */
export function reasonEntry(code: number, reason: string, port?: number | null): string | null {
  const portPart = typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535 ? `.${port}` : '';
  const entry = `${code}:${reason}${portPart}`;
  return REASON_ENTRY.test(entry) ? entry : null;
}

/**
 * Counts in localStorage (memory when storage is blocked), shared by the tabs
 * of the site. Never throws: counting never matters more than the SDK's work.
 */
export class SdkDiagnostics {
  private memory: DiagnosticsCounts = emptyCounts();
  // Set once storage refused a write: from then on this page counts in memory.
  private memoryOnly = false;

  constructor(
    private enabled: boolean = true,
    private readonly storage: () => KeyValueStorage | null = defaultStorage,
  ) {
    if (!enabled) this.clear();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Adds one for `code`, and one for its reason when given. A 17th distinct
   * code is dropped; a 17th distinct reason entry is not kept but its code is
   * still counted.
   */
  count(code: number, reason?: string | null, port?: number | null): void {
    if (!this.enabled) return;
    try {
      if (!Number.isInteger(code) || code < 1000 || code > 9999) return;
      const counts = this.load();
      const key = String(code);
      if (!(key in counts.codes) && Object.keys(counts.codes).length >= MAX_CODES) return;
      counts.codes[key] = Math.min((counts.codes[key] ?? 0) + 1, MAX_COUNT);
      const entry = reason ? reasonEntry(code, reason, port) : null;
      if (entry && (entry in counts.reasons || Object.keys(counts.reasons).length < MAX_REASONS)) {
        counts.reasons[entry] = Math.min((counts.reasons[entry] ?? 0) + 1, MAX_COUNT);
      }
      this.save(counts);
    } catch {
      // ignore
    }
  }

  /** What would be sent now. */
  pending(): DiagnosticsCounts {
    if (!this.enabled) return emptyCounts();
    try {
      return this.load();
    } catch {
      return emptyCounts();
    }
  }

  /** The headers for the next request, or null when there is nothing to send. */
  report(): DiagnosticsReport | null {
    if (!this.enabled) return null;
    try {
      const pending = this.pending();
      const codes = Object.keys(pending.codes)
        .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
        .slice(0, MAX_CODES);
      const sent: DiagnosticsCounts = emptyCounts();
      for (const code of codes) sent.codes[code] = Math.min(Math.max(pending.codes[code], 1), MAX_COUNT);
      const headers: Record<string, string> = {};
      if (codes.length > 0) headers[REPORT_HEADER] = codes.map((code) => `${code}=${sent.codes[code]}`).join(' ');

      const parts: string[] = [];
      let length = 0;
      // Reasons that did not fit an earlier header go later, after their code
      // was already sent: the server adds them up all the same.
      const entries = Object.keys(pending.reasons).sort(byCodeThenKey);
      for (const entry of entries) {
        if (parts.length >= MAX_REASONS) break;
        const n = Math.min(Math.max(pending.reasons[entry], 1), MAX_COUNT);
        const part = `${entry}=${n}`;
        const added = (parts.length > 0 ? 1 : 0) + part.length;
        if (length + added > MAX_REASONS_HEADER_LENGTH) continue;
        parts.push(part);
        length += added;
        sent.reasons[entry] = n;
      }
      if (parts.length > 0) headers[REASONS_HEADER] = parts.join(' ');
      return Object.keys(headers).length > 0 ? { headers, sent } : null;
    } catch {
      return null;
    }
  }

  /** The server took `sent` (2xx): subtract it; counts added meanwhile stay for the next request. */
  acknowledge(sent: DiagnosticsCounts): void {
    try {
      const counts = this.load();
      for (const [code, n] of Object.entries(sent.codes)) {
        const left = (counts.codes[code] ?? 0) - n;
        if (left > 0) counts.codes[code] = left;
        else delete counts.codes[code];
      }
      for (const [entry, n] of Object.entries(sent.reasons)) {
        const left = (counts.reasons[entry] ?? 0) - n;
        if (left > 0) counts.reasons[entry] = left;
        else delete counts.reasons[entry];
      }
      this.save(counts);
    } catch {
      // Sent again next time; a count a little high is better than a failure.
    }
  }

  /** Forgets every count (memory and storage). */
  clear(): void {
    this.memory = emptyCounts();
    try {
      this.storage()?.removeItem(DIAGNOSTICS_STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  private load(): DiagnosticsCounts {
    try {
      const s = this.memoryOnly ? null : this.storage();
      if (s) {
        const raw = s.getItem(DIAGNOSTICS_STORAGE_KEY);
        // Storage works: it holds the counts of every tab.
        return parseCounts(raw);
      }
    } catch {
      // Storage blocked: fall back to this page's memory.
    }
    return { codes: { ...this.memory.codes }, reasons: { ...this.memory.reasons } };
  }

  private save(counts: DiagnosticsCounts): void {
    this.memory = { codes: { ...counts.codes }, reasons: { ...counts.reasons } };
    if (this.memoryOnly) return;
    try {
      const s = this.storage();
      if (!s) return;
      if (Object.keys(counts.codes).length === 0 && Object.keys(counts.reasons).length === 0) s.removeItem(DIAGNOSTICS_STORAGE_KEY);
      else s.setItem(DIAGNOSTICS_STORAGE_KEY, JSON.stringify({ c: counts.codes, r: counts.reasons }));
    } catch {
      // Storage blocked or full: kept in memory for this page load.
      this.memoryOnly = true;
    }
  }
}

/** True when `url` is on the same origin as the Push API `baseUrl`. Never throws. */
export function isPushApiUrl(url: string, baseUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}
