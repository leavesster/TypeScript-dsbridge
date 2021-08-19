declare global {
    interface Window {
        dscb: number;
        // Android 注入，表示 js 可以从 native 端直接拿到回调
        _dsbridge?: any;
        // iOS WKWebview 注入
        _dswk?: any;
        // 存储加回调方法的对象
        _dsaf: any;
        // 存储不加回调方法的对象
        _dsf: any;
        _dsInit: boolean;
    }
}

type FunctionScope = "all" | "asyn" | "syn";
type JsonValue = string | number | boolean | null | undefined | {
    [key: string]: JsonValue;
} | JsonValue[];

type Callback<R> = (result: R) => void;
type SynFun<T> = (...args: T[]) => void | T;
type AsyncCallback = (data: JsonValue, complete: true) => void;
// 如果 native 要接受 js 的回调，则最后一个是 AsyncCallback
type AsyncFun<T> = (...args: T[]) => void;

// js 端同步方法，很简单，直接返回 JSValue 即可
type SynObject = {
    [key: string]: SynFun<JsonValue>;
} | SynFun<JsonValue>;

type AsyncObject = {
    [key: string]: AsyncFun<JsonValue>;
} | AsyncFun<JsonValue>;

type NativeParams = {
    method: string;
    callbackId: number;
    // native 传递的所有参数，传送给 js 前，会从数组转为 string
    data: string;
}

interface Bridge {
    // 调用 native 的同步 API，call function 返回值即为 string。(Android 可以返回 JSValue，iOS 通过 prompt 实现相同效果)
    // 调用 native 的异步 API，需要传入回调参数 Callback，来接受 native 完成后的回调。
    call(nativeMethod: string, args?: JsonValue | Callback<string>, callback?: Callback<string>): JsonValue | undefined;

    register(handlerName: string, handler: SynObject | AsyncObject, async?: boolean): void;
    registerAsyn(handlerName: string, handler: AsyncObject): void;

    hasNativeMethod(handlerName: string, type?: FunctionScope): boolean;
    disableJavascriptDialogBlock(disable?: boolean): void;
}

const dsBridge = (function() {
    const call = (nativeMethod: string, parameter?: JsonValue | Callback<string>, callback?: Callback<string>) => {

        if (typeof parameter === "function") {
            callback = parameter;
            parameter = {};
        }

        const jsonArg = {data: parameter === undefined ? null : parameter};

        if (callback) {
            // native 异步回调 js 时，调用方法
            const cbName = `dscb${window.dscb ++}`;
            window[cbName] = callback;
        }

        const stringifyArg = JSON.stringify(jsonArg);

        let result = "";
        if (window._dsbridge) {
            // Android 可以主动注入，但是只能传一个值，因为 iOS 只能通过 prompt 传 string。其实就是保持 Native 两端实现逻辑
            result = window._dsbridge.call(nativeMethod, stringifyArg);
        } else if (window._dswk || navigator.userAgent.indexOf("_dsbridge") !== -1) {
            const ios = prompt(`_dsbridge=${nativeMethod}`, stringifyArg);
            result = ios ? result : "{}";
        }
        return JSON.parse(result).data;
    }

    const register = (handlerName: string, handler: SynObject | AsyncObject, async?: boolean) => {
        const namespace = async ? window._dsaf : window._dsf;
        if (!window._dsInit) {
            window._dsInit = true;
            setTimeout(() => {
                (this as Bridge).call("dsb.dsinit");
            }, 0);
        }
        if (typeof handler === "object") {
            namespace._obs[handlerName] = handler;
        } else {
            namespace[handlerName] = handler;
        }
    }
    const registerAsyn = (handlerName: string, handler: AsyncObject) => {
        (this as Bridge).register(handlerName, handler, true);
    }

    const hasNativeMethod = (name: string, type: FunctionScope= "all") => {
        return !!(this as Bridge).call("_dsb.hasNativeMethod", {name: name, type: type});
    }

    const disableJavascriptDialogBlock = (disable: boolean= true) => {
        (this as Bridge).call("_dsb.disableJavascriptDialogBlock", {disable});
    }

    const defaultThis = () => {
        return this as Bridge;
    }
    return defaultThis();
})();

type BridgeFunctionObject = {
    dscb: number;
    dsBridge: Bridge;
    close: () => void;
    _handleMessageFromNative: (natvieInfo: any) => void;
    _dsf: {
        [key: string]: SynObject;
    };
    _dsaf: {
        [key: string]: AsyncObject;
    }
};

type JsReturnValue = {
    data: JsonValue;
    id: number;
    complete: boolean;
}

(function(): void {
    if (window._dsf) {
        return;
    }
    const ob: BridgeFunctionObject = {
        _dsf: {
            _obs: {},
        },
        _dsaf: {
            _obs: {},
        },
        dscb: 0,
        dsBridge: dsBridge,
        close: function(): void {
            dsBridge.call("_dsb.closePage");
        },
        _handleMessageFromNative: (info: NativeParams) => {
            const {method, data, callbackId} = info;
            const nativeArgs = JSON.parse(data) as JsonValue[];
            const ret: JsReturnValue = {
                data: "",
                id: callbackId,
                complete: true,
            };

            const syncfun = (this as BridgeFunctionObject)._dsf[method] as SynFun<JsonValue>;
            const asynFunc = (this as BridgeFunctionObject)._dsaf[method] as AsyncFun<JsonValue>;
            const callSyn = (fn: SynFun<JsonValue>, ob: SynObject) => {
                ret.data = fn.apply(ob, nativeArgs) as JsonValue;
                dsBridge.call("_dsb.returnValue", ret);
            };

            const callAsyn = (fn: AsyncFun<any>, ob: AsyncObject) => {
                const nativeArgsAndCallback: any[] = (nativeArgs as any).push((data: string, complete: boolean = true) => {
                    ret.data = data,
                    ret.complete = complete;
                    dsBridge.call("_dsb.returnValue", ret);
                });
                fn.apply(ob, nativeArgsAndCallback);
            };
            if (syncfun) {
                callSyn(syncfun, this._dsf);
            } else if (asynFunc) {
                callAsyn(asynFunc, this._dsaf);
            } else {
                const delimiter = ".";
                const name = method.split(delimiter);
                if (name.length < 2) {
                    return;
                }
                const methodName = name.pop() as string;
                const methodNameSpace = name.join(delimiter);
                let obs = this._dfs.obs;
                let ob = obs[methodNameSpace] || {};
                let m = ob[methodName];
                if (m && typeof m === "function") {
                    callSyn(m, ob);
                    return;
                }
                obs = this._dsaf._obs;
                ob = obs[methodNameSpace] || {};
                m = ob[methodName];
                if (m && typeof m === "function") {
                    callAsyn(m, ob);
                    return;
                }
            }
        },
    };
    for (let attr in ob) {
        window[attr] = ob;
    }
    const _dsf = ob._dsf;
    const _dsaf = ob._dsaf;

    dsBridge.register("_hasJavascriptMethod", function(method): boolean {
        if (typeof method !== "string") {
            return false;
        }
        const splitName = method.split('.');
        if (splitName.length < 2) {
            return !!(_dsf[method]||_dsaf[method]);
        } else {
           var methodName = splitName.pop() as string;
           var namespace = splitName.join('.');
           var ob = _dsf._obs[namespace] || _dsaf._obs[namespace];
           return ob && !!ob[methodName];
        }
    })
}());

export default dsBridge;