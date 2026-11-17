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
export declare const REPORT_HEADER = "X-Abrova-SDK-Report";
export declare const REASONS_HEADER = "X-Abrova-SDK-Report-Reasons";
/** Most codes, most reason entries and highest count per report (the server accepts no more). */
export declare const MAX_CODES = 16;
export declare const MAX_REASONS = 16;
export declare const MAX_COUNT = 9999;
/** Longest reasons header the server accepts. */
export declare const MAX_REASONS_HEADER_LENGTH = 400;
export declare const DIAGNOSTICS_STORAGE_KEY = "abrova_push_diagnostics";
/** `http<status>` for an answer with status >= 400, else null. */
export declare function httpReason(status: unknown): string | null;
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
export declare function classifyError(error: unknown, nav?: unknown): string;
/**
 * Reason of a failed Push API request: as classifyError, and a fetch that
 * rejected with a TypeError (the browser hides why) counts as `socket`.
 */
export declare function classifyRequestError(error: unknown, nav?: unknown): string;
interface KeyValueStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
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
/** `<code>:<reason>[.<port>]`, or null when it would not match the server's grammar. */
export declare function reasonEntry(code: number, reason: string, port?: number | null): string | null;
/**
 * Counts in localStorage (memory when storage is blocked), shared by the tabs
 * of the site. Never throws: counting never matters more than the SDK's work.
 */
export declare class SdkDiagnostics {
    private enabled;
    private readonly storage;
    private memory;
    private memoryOnly;
    constructor(enabled?: boolean, storage?: () => KeyValueStorage | null);
    isEnabled(): boolean;
    /**
     * Adds one for `code`, and one for its reason when given. A 17th distinct
     * code is dropped; a 17th distinct reason entry is not kept but its code is
     * still counted.
     */
    count(code: number, reason?: string | null, port?: number | null): void;
    /** What would be sent now. */
    pending(): DiagnosticsCounts;
    /** The headers for the next request, or null when there is nothing to send. */
    report(): DiagnosticsReport | null;
    /** The server took `sent` (2xx): subtract it; counts added meanwhile stay for the next request. */
    acknowledge(sent: DiagnosticsCounts): void;
    /** Forgets every count (memory and storage). */
    clear(): void;
    private load;
    private save;
}
/** True when `url` is on the same origin as the Push API `baseUrl`. Never throws. */
export declare function isPushApiUrl(url: string, baseUrl: string): boolean;
export {};
