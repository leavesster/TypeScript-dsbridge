declare global {
    interface Window {
        dscb: number;
        _dsbridge?: any;
        _dswk?: any;
        _dsaf: any;
        _dsf: any;
        _dsInit: boolean;
    }
}

export type FunctionScope = "all" | "asyn" | "syn";
export type JsValue = string | number | boolean | null | {
    [key: string]: JsValue,
} | JsValue[];

export type Callback<R> = (result: R) => void;
export type RegisterFun<T> = (...args: T[]) => void | T;
export type RegisterAysnFun<T> = (args: T[], callback: Callback<string>) => void;

export type SynObject = {
    [key: string]: RegisterFun<JsValue>;
} | RegisterFun<JsValue>;

export type AysnObject = {
    [key: string]: RegisterAysnFun<JsValue>;
} | RegisterAysnFun<JsValue>;

interface Bridge {
    call(nativeMethod: string, args?: JsValue | Callback<string>, callback?: Callback<string>): string | undefined;
    register(handlerName: string, handler: SynObject | AysnObject, async?: boolean): void;
    registerAsyn(handlerName: string, handler: AysnObject): void;
    hasNativeMethod(handlerName: string, type?: FunctionScope): boolean;
    disableJavascriptDialogBlock(disable?: boolean): void;
}

const dsBridge = (function() {
    const call = (nativeMethod: string, parameter?: JsValue | Callback<string>, callback?: Callback<string>) => {

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

    const register = (handlerName: string, handler: SynObject | AysnObject, async?: boolean) => {
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
    const registerAsyn = (handlerName: string, handler: AysnObject) => {
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
    _dsf: any;
    _dsaf: any;
};

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
        _handleMessageFromNative: (info: any) => {
            const {method, data, callbackId} = info;
            const nativeArg = JSON.parse(data) as any[];
            const ret = {
                data: "",
                id: callbackId,
                complete: true,
            };

            const fun = this._dsf[method];
            const asynFunc = this._dsaf[method];
            const callSyn = (fn: any, ob: any) => {
                ret.data = fun.apply(ob, nativeArg);
                dsBridge.call("_dsb.returnValue", ret);
            };
            const callAsyn = (fn: any, ob: any) => {
                nativeArg.push((data: string, complete: boolean= true) => {
                    ret.data = data,
                    ret.complete = complete;
                    dsBridge.call("_dsb.returnValue", ret);
                });
                fn.apply(ob, nativeArg);
            };
            if (fun) {
                callSyn(fun, this._dsf);
            } else if (asynFunc) {
                callAsyn(asynFunc, this._dsaf);
            } else {
                const delimiter = ".";
                const name = (method as string).split(delimiter);
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

    dsBridge.register("_hasJavascriptMethod", function (method: string): boolean {
        const splitName = method.split('.');
        if (splitName.length < 2) {
            return !!(_dsf[method]||_dsaf[method]);
        } else {
           var methodName = splitName.pop();
           var namespace = splitName.join('.');
           var ob = _dsf._obs[namespace] || _dsaf._obs[namespace];
           return ob && !!ob[method];
        }
    })
}());

export default dsBridge;