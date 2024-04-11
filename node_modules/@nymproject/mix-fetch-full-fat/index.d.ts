import type { SetupMixFetchOps, IMixFetchFn, IMixFetch } from './types';
export * from './types';
declare global {
    interface Window {
        /**
         * Keep a singleton of the mixFetch interface on the `window` object.
         */
        __mixFetchGlobal?: IMixFetch;
    }
}
/**
 * Create a global mixFetch instance and optionally configure settings.
 *
 * @param opts Optional settings
 */
export declare const createMixFetch: (opts?: SetupMixFetchOps) => Promise<IMixFetch>;
/**
 * mixFetch is a drop-in replacement for the standard `fetch` interface.
 *
 * @param url  The URL to fetch from.
 * @param args Fetch options.
 * @param opts Optionally configure mixFetch when it gets created. This only happens once, the first time it gets used.
 */
export declare const mixFetch: IMixFetchFn;
/**
 * Stops the usage of mixFetch and disconnect the client from the mixnet.
 */
export declare const disconnectMixFetch: () => Promise<void>;
