import { IMixFetch } from './types';
/**
 * Use this method to initialise `mixFetch`.
 *
 * @returns An instance of `mixFetch` that you can use to make your requests using the same interface as `fetch`.
 */
export declare const createMixFetch: () => Promise<IMixFetch>;
