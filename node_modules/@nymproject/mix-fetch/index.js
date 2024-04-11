function createURLWorkerFactory(url) {
    return function WorkerFactory(options) {
        return new Worker(url, options);
    };
}

var WorkerFactory = createURLWorkerFactory(new URL('web-worker-0.js', import.meta.url));
/* eslint-enable */

/**
 * @license
 * Copyright 2019 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
const proxyMarker = Symbol("Comlink.proxy");
const createEndpoint = Symbol("Comlink.endpoint");
const releaseProxy = Symbol("Comlink.releaseProxy");
const finalizer = Symbol("Comlink.finalizer");
const throwMarker = Symbol("Comlink.thrown");
const isObject = (val) => (typeof val === "object" && val !== null) || typeof val === "function";
/**
 * Internal transfer handle to handle objects marked to proxy.
 */
const proxyTransferHandler = {
    canHandle: (val) => isObject(val) && val[proxyMarker],
    serialize(obj) {
        const { port1, port2 } = new MessageChannel();
        expose(obj, port1);
        return [port2, [port2]];
    },
    deserialize(port) {
        port.start();
        return wrap(port);
    },
};
/**
 * Internal transfer handler to handle thrown exceptions.
 */
const throwTransferHandler = {
    canHandle: (value) => isObject(value) && throwMarker in value,
    serialize({ value }) {
        let serialized;
        if (value instanceof Error) {
            serialized = {
                isError: true,
                value: {
                    message: value.message,
                    name: value.name,
                    stack: value.stack,
                },
            };
        }
        else {
            serialized = { isError: false, value };
        }
        return [serialized, []];
    },
    deserialize(serialized) {
        if (serialized.isError) {
            throw Object.assign(new Error(serialized.value.message), serialized.value);
        }
        throw serialized.value;
    },
};
/**
 * Allows customizing the serialization of certain values.
 */
const transferHandlers = new Map([
    ["proxy", proxyTransferHandler],
    ["throw", throwTransferHandler],
]);
function isAllowedOrigin(allowedOrigins, origin) {
    for (const allowedOrigin of allowedOrigins) {
        if (origin === allowedOrigin || allowedOrigin === "*") {
            return true;
        }
        if (allowedOrigin instanceof RegExp && allowedOrigin.test(origin)) {
            return true;
        }
    }
    return false;
}
function expose(obj, ep = globalThis, allowedOrigins = ["*"]) {
    ep.addEventListener("message", function callback(ev) {
        if (!ev || !ev.data) {
            return;
        }
        if (!isAllowedOrigin(allowedOrigins, ev.origin)) {
            console.warn(`Invalid origin '${ev.origin}' for comlink proxy`);
            return;
        }
        const { id, type, path } = Object.assign({ path: [] }, ev.data);
        const argumentList = (ev.data.argumentList || []).map(fromWireValue);
        let returnValue;
        try {
            const parent = path.slice(0, -1).reduce((obj, prop) => obj[prop], obj);
            const rawValue = path.reduce((obj, prop) => obj[prop], obj);
            switch (type) {
                case "GET" /* MessageType.GET */:
                    {
                        returnValue = rawValue;
                    }
                    break;
                case "SET" /* MessageType.SET */:
                    {
                        parent[path.slice(-1)[0]] = fromWireValue(ev.data.value);
                        returnValue = true;
                    }
                    break;
                case "APPLY" /* MessageType.APPLY */:
                    {
                        returnValue = rawValue.apply(parent, argumentList);
                    }
                    break;
                case "CONSTRUCT" /* MessageType.CONSTRUCT */:
                    {
                        const value = new rawValue(...argumentList);
                        returnValue = proxy(value);
                    }
                    break;
                case "ENDPOINT" /* MessageType.ENDPOINT */:
                    {
                        const { port1, port2 } = new MessageChannel();
                        expose(obj, port2);
                        returnValue = transfer(port1, [port1]);
                    }
                    break;
                case "RELEASE" /* MessageType.RELEASE */:
                    {
                        returnValue = undefined;
                    }
                    break;
                default:
                    return;
            }
        }
        catch (value) {
            returnValue = { value, [throwMarker]: 0 };
        }
        Promise.resolve(returnValue)
            .catch((value) => {
            return { value, [throwMarker]: 0 };
        })
            .then((returnValue) => {
            const [wireValue, transferables] = toWireValue(returnValue);
            ep.postMessage(Object.assign(Object.assign({}, wireValue), { id }), transferables);
            if (type === "RELEASE" /* MessageType.RELEASE */) {
                // detach and deactive after sending release response above.
                ep.removeEventListener("message", callback);
                closeEndPoint(ep);
                if (finalizer in obj && typeof obj[finalizer] === "function") {
                    obj[finalizer]();
                }
            }
        })
            .catch((error) => {
            // Send Serialization Error To Caller
            const [wireValue, transferables] = toWireValue({
                value: new TypeError("Unserializable return value"),
                [throwMarker]: 0,
            });
            ep.postMessage(Object.assign(Object.assign({}, wireValue), { id }), transferables);
        });
    });
    if (ep.start) {
        ep.start();
    }
}
function isMessagePort(endpoint) {
    return endpoint.constructor.name === "MessagePort";
}
function closeEndPoint(endpoint) {
    if (isMessagePort(endpoint))
        endpoint.close();
}
function wrap(ep, target) {
    return createProxy(ep, [], target);
}
function throwIfProxyReleased(isReleased) {
    if (isReleased) {
        throw new Error("Proxy has been released and is not useable");
    }
}
function releaseEndpoint(ep) {
    return requestResponseMessage(ep, {
        type: "RELEASE" /* MessageType.RELEASE */,
    }).then(() => {
        closeEndPoint(ep);
    });
}
const proxyCounter = new WeakMap();
const proxyFinalizers = "FinalizationRegistry" in globalThis &&
    new FinalizationRegistry((ep) => {
        const newCount = (proxyCounter.get(ep) || 0) - 1;
        proxyCounter.set(ep, newCount);
        if (newCount === 0) {
            releaseEndpoint(ep);
        }
    });
function registerProxy(proxy, ep) {
    const newCount = (proxyCounter.get(ep) || 0) + 1;
    proxyCounter.set(ep, newCount);
    if (proxyFinalizers) {
        proxyFinalizers.register(proxy, ep, proxy);
    }
}
function unregisterProxy(proxy) {
    if (proxyFinalizers) {
        proxyFinalizers.unregister(proxy);
    }
}
function createProxy(ep, path = [], target = function () { }) {
    let isProxyReleased = false;
    const proxy = new Proxy(target, {
        get(_target, prop) {
            throwIfProxyReleased(isProxyReleased);
            if (prop === releaseProxy) {
                return () => {
                    unregisterProxy(proxy);
                    releaseEndpoint(ep);
                    isProxyReleased = true;
                };
            }
            if (prop === "then") {
                if (path.length === 0) {
                    return { then: () => proxy };
                }
                const r = requestResponseMessage(ep, {
                    type: "GET" /* MessageType.GET */,
                    path: path.map((p) => p.toString()),
                }).then(fromWireValue);
                return r.then.bind(r);
            }
            return createProxy(ep, [...path, prop]);
        },
        set(_target, prop, rawValue) {
            throwIfProxyReleased(isProxyReleased);
            // FIXME: ES6 Proxy Handler `set` methods are supposed to return a
            // boolean. To show good will, we return true asynchronously ¯\_(ツ)_/¯
            const [value, transferables] = toWireValue(rawValue);
            return requestResponseMessage(ep, {
                type: "SET" /* MessageType.SET */,
                path: [...path, prop].map((p) => p.toString()),
                value,
            }, transferables).then(fromWireValue);
        },
        apply(_target, _thisArg, rawArgumentList) {
            throwIfProxyReleased(isProxyReleased);
            const last = path[path.length - 1];
            if (last === createEndpoint) {
                return requestResponseMessage(ep, {
                    type: "ENDPOINT" /* MessageType.ENDPOINT */,
                }).then(fromWireValue);
            }
            // We just pretend that `bind()` didn’t happen.
            if (last === "bind") {
                return createProxy(ep, path.slice(0, -1));
            }
            const [argumentList, transferables] = processArguments(rawArgumentList);
            return requestResponseMessage(ep, {
                type: "APPLY" /* MessageType.APPLY */,
                path: path.map((p) => p.toString()),
                argumentList,
            }, transferables).then(fromWireValue);
        },
        construct(_target, rawArgumentList) {
            throwIfProxyReleased(isProxyReleased);
            const [argumentList, transferables] = processArguments(rawArgumentList);
            return requestResponseMessage(ep, {
                type: "CONSTRUCT" /* MessageType.CONSTRUCT */,
                path: path.map((p) => p.toString()),
                argumentList,
            }, transferables).then(fromWireValue);
        },
    });
    registerProxy(proxy, ep);
    return proxy;
}
function myFlat(arr) {
    return Array.prototype.concat.apply([], arr);
}
function processArguments(argumentList) {
    const processed = argumentList.map(toWireValue);
    return [processed.map((v) => v[0]), myFlat(processed.map((v) => v[1]))];
}
const transferCache = new WeakMap();
function transfer(obj, transfers) {
    transferCache.set(obj, transfers);
    return obj;
}
function proxy(obj) {
    return Object.assign(obj, { [proxyMarker]: true });
}
function toWireValue(value) {
    for (const [name, handler] of transferHandlers) {
        if (handler.canHandle(value)) {
            const [serializedValue, transferables] = handler.serialize(value);
            return [
                {
                    type: "HANDLER" /* WireValueType.HANDLER */,
                    name,
                    value: serializedValue,
                },
                transferables,
            ];
        }
    }
    return [
        {
            type: "RAW" /* WireValueType.RAW */,
            value,
        },
        transferCache.get(value) || [],
    ];
}
function fromWireValue(value) {
    switch (value.type) {
        case "HANDLER" /* WireValueType.HANDLER */:
            return transferHandlers.get(value.name).deserialize(value.value);
        case "RAW" /* WireValueType.RAW */:
            return value.value;
    }
}
function requestResponseMessage(ep, msg, transfers) {
    return new Promise((resolve) => {
        const id = generateUUID();
        ep.addEventListener("message", function l(ev) {
            if (!ev.data || !ev.data.id || ev.data.id !== id) {
                return;
            }
            ep.removeEventListener("message", l);
            resolve(ev.data);
        });
        if (ep.start) {
            ep.start();
        }
        ep.postMessage(Object.assign({ id }, msg), transfers);
    });
}
function generateUUID() {
    return new Array(4)
        .fill(0)
        .map(() => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(16))
        .join("-");
}

var EventKinds;
(function (EventKinds) {
    EventKinds["Loaded"] = "Loaded";
})(EventKinds || (EventKinds = {}));
/**
 * Default values for the handling of response bodies.
 */
const ResponseBodyConfigMapDefaults = {
    uint8array: ['application/octet-stream'],
    json: ['application/json', 'text/json', /application\/json.*/, /text\/json\+.*/],
    text: ['text/plain', /text\/plain.*/, 'text/html', /text\/html.*/],
    formData: ['application/x-www-form-urlencoded', 'multipart/form-data'],
    blob: [/image\/.*/, /video\/.*/],
    fallback: 'blob',
};

const createWorker = async () => new Promise((resolve, reject) => {
    // rollup will inline the built worker script, so that when the SDK is used in
    // other projects, they will not need to mess around trying to bundle it
    // however, it will make this SDK bundle bigger because of Base64 inline data
    const worker = new WorkerFactory({ type: 'module' });
    worker.addEventListener('error', reject);
    worker.addEventListener('message', (msg) => {
        worker.removeEventListener('error', reject);
        if (msg.data?.kind === EventKinds.Loaded) {
            resolve(worker);
        }
        else {
            reject(msg);
        }
    }, { once: true });
});
const convertHeaders = (headers) => {
    const out = new Headers();
    Object.keys(headers).forEach((key) => {
        out.append(key, headers[key]);
    });
    return out;
};
/**
 * Use this method to initialise `mixFetch`.
 *
 * @returns An instance of `mixFetch` that you can use to make your requests using the same interface as `fetch`.
 */
const createMixFetch$1 = async () => {
    // start the worker
    const worker = await createWorker();
    // bind with Comlink
    const wrappedWorker = wrap(worker);
    // handle the responses
    const mixFetchWebWorker = {
        setupMixFetch: wrappedWorker.setupMixFetch,
        mixFetch: async (url, args) => {
            const workerResponse = await wrappedWorker.mixFetch(url, args);
            if (!workerResponse) {
                throw new Error('No response received');
            }
            console.log({ workerResponse });
            const { headers: headersRaw, status, statusText } = workerResponse;
            // reconstruct the Headers object instance from a plain object
            const headers = convertHeaders(headersRaw);
            // handle blobs
            if (workerResponse.body.blobUrl) {
                const blob = await (await fetch(workerResponse.body.blobUrl)).blob();
                const body = await blob.arrayBuffer();
                return new Response(body, { headers, status, statusText });
            }
            // handle everything else
            const body = Object.values(workerResponse.body)[0]; // we are expecting only one value to be set in `.body`
            return new Response(body, { headers, status, statusText });
        },
        disconnectMixFetch: wrappedWorker.disconnectMixFetch,
    };
    return mixFetchWebWorker;
};

// this is the default timeout for getting a response
const REQUEST_TIMEOUT_MILLISECONDS = 60_000;
/**
 * Create a global mixFetch instance and optionally configure settings.
 *
 * @param opts Optional settings
 */
const createMixFetch = async (opts) => {
    if (!window) {
        throw new Error('`window` is not defined');
    }
    if (!window.__mixFetchGlobal) {
        // load the worker and set up mixFetch with defaults
        window.__mixFetchGlobal = await createMixFetch$1();
        await window.__mixFetchGlobal.setupMixFetch(opts);
        window.onunload = async () => {
            if (window.__mixFetchGlobal) {
                await window.__mixFetchGlobal.disconnectMixFetch();
            }
        };
    }
    return window.__mixFetchGlobal;
};
/**
 * mixFetch is a drop-in replacement for the standard `fetch` interface.
 *
 * @param url  The URL to fetch from.
 * @param args Fetch options.
 * @param opts Optionally configure mixFetch when it gets created. This only happens once, the first time it gets used.
 */
const mixFetch = async (url, args, opts) => {
    // ensure mixFetch instance exists
    const instance = await createMixFetch({
        mixFetchOverride: {
            requestTimeoutMs: REQUEST_TIMEOUT_MILLISECONDS,
        },
        ...opts,
    });
    // execute user request
    return instance.mixFetch(url, args);
};
/**
 * Stops the usage of mixFetch and disconnect the client from the mixnet.
 */
const disconnectMixFetch = async () => {
    if (!window) {
        throw new Error('`window` is not defined');
    }
    // JS: I'm ignoring this lint (no-else-return) because I want to explicitly state
    // that `__mixFetchGlobal` is definitely not null in the else branch.
    if (!window.__mixFetchGlobal) {
        throw new Error("mixFetch hasn't been setup");
        // eslint-disable-next-line no-else-return
    }
    else {
        return window.__mixFetchGlobal.disconnectMixFetch();
    }
};

export { EventKinds, ResponseBodyConfigMapDefaults, createMixFetch, disconnectMixFetch, mixFetch };
