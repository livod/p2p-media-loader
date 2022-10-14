// @ts-nocheck

class RumLogger {
    private debounce;
    private debounceTime = 3000;
    private isInitialed = false;
    private isTest = true;
    private cacheDataLimitCount = 10000;
    private disabledAppsFromCentralConfig = [];
    protected baseUrl: string;
    protected ccloudAppId;
    protected dataIndexId: string;
    protected infoArr = [];
    protected commonInfo;
    protected sid;

    // dataId:数据聚合索引id，这个是grail默认的id不能删除，但可以传入自定的id
    constructor({ ccloudAppId = "", isTest = true, dataId = "fe_monitor_e7a2cef6", cacheDataLimitCount = 10000 }) {
        this.cacheDataLimitCount = cacheDataLimitCount;
        this.isTest = isTest;
        this.baseUrl = isTest ? "apm.gz.cvte.cn" : "myou.cvte.com";
        this.sid = nanoid();
        this.debounce = debounce();
        this.ccloudAppId = ccloudAppId;
        // kibana的数据分类索引id
        this.dataIndexId = dataId;

        const user_agent = navigator.userAgent;
        this.commonInfo = {
            user_agent: user_agent,
            // 业务自定义
            mid: "", //设备id，可以由用户填入
            uid: "",
            version: "",
            version_value: 0,
        };

        this.init = this.init.bind(this);
        this.send = this.send.bind(this);
        this.pushAllInstance = this.pushAllInstance.bind(this);
        this.pushPerformance = this.pushPerformance.bind(this);
        this.pushError = this.pushError.bind(this);
        this.push = this.push.bind(this);
        // this.fetchCentralConfigImmediately();
    }

    init(commonInfo = {}) {
        if (!(typeof commonInfo === "object")) {
            throw new Error("commonInfo must be an object");
        }
        this.mergeCommonInfo(commonInfo);
        this.isInitialed = true;
    }

    private fetchCentralConfigInterval() {
        let timerId;
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        return (function () {
            if (timerId) {
                clearTimeout(timerId);
            }
            timerId = setTimeout(() => {
                self.fetchCentralConfigImmediately();
            }, 60000);
        })();
    }

    private fetchCentralConfigImmediately() {
        let centralConfigUrl = "//ccloud.gz.cvte.cn/central-config";
        if (!this.isTest) {
            centralConfigUrl = "//ccloud.cvte.com/central-config";
        }
        fetch(centralConfigUrl, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
            mode: "cors",
        })
            .then((resp) => resp.json())
            .then((result) => {
                if (result.code === 0 && result.data && result.data.rumLoggerDisableApps) {
                    this.disabledAppsFromCentralConfig = result.data.rumLoggerDisableApps;
                    console.log("central config:", this.disabledAppsFromCentralConfig);
                }
                this.fetchCentralConfigInterval();
            })
            .catch((err) => {
                console.error("error occur when fetch central config:", err);
                this.fetchCentralConfigInterval();
            });
    }

    private mergeCommonInfo(commonInfo) {
        const temp = {
            ...commonInfo,
            category1: commonInfo.category1 || commonInfo.subapp,
        };
        if (temp.subapp) {
            delete temp.subapp;
        }
        this.removeUndefinedFields(temp);
        Object.assign(this.commonInfo, temp);
    }

    // 这里的信息会被每个实例都拿到并上报
    /**
     *@deprecated 已过时，请使用push接口上报
     * @param data 日志参数
     */
    pushAllInstance(data) {
        this.push(data);
    }

    /**
     * 上报性能数据
     * @param {string} metric 性能指标名称
     * @param {number} value 时长(ms)
     * @param {string} category 可选。性能指标类别
     */
    pushPerformance(metric, value, category = undefined) {
        if (!(typeof metric === "string" && metric.length > 0)) {
            throw new Error("metric can not be an empty string");
        }
        if (!(typeof value === "number")) {
            throw new Error("value should be a number");
        }
        const temp = {
            // 自定义性能指标数据
            class: "custom-performance",
            category3: category,
            category5: metric,
            value,
        };
        this.removeUndefinedFields(temp);
        this.push(temp);
    }

    /**
     * 上传自定义错误数据
     *
     * @deprecated 已过时，apm会捕获异常并上报，不要使用该接口上报错误堆栈信息，其他日志请使用push接口上报
     * @param {string} error 自定义错误名称
     * @param {string} category 可选。错误类别
     * @param {string} message 可选。错误描述
     */
    pushError(error, category = undefined, message = undefined) {
        if (!(typeof error === "string" && error.length > 0)) {
            throw new Error("error should be not empty string");
        }
        const temp = {
            class: "known_error",
            category3: category,
            category5: error,
            description: message,
        };
        this.removeUndefinedFields(temp);
        this.push(temp);
    }

    /**
     * 移除对象中字段值为undefined的key
     * 该方法会修改源对象，并返回源对象的引用。
     * @param {Object} obj 需要修改的源对象
     */
    private removeUndefinedFields(obj) {
        Object.keys(obj).forEach((key) => obj[key] === undefined && delete obj[key]);
        return obj;
    }

    push(data) {
        if (!(typeof data === "object" && Object.keys(data).length > 0)) {
            throw new Error("data should be an object with some values");
        }
        if (Array.isArray(data)) {
            throw new Error("data can not be an array, it should be type of Object");
        }
        if (this.infoArr.length > this.cacheDataLimitCount) {
            this.infoArr = this.infoArr.slice(Math.floor(this.cacheDataLimitCount / 2));
        }
        if (!this.canPush(data)) {
            return;
        }

        this.infoArr.push(
            // 在数据缓存时记录时间，而不是发送时，确保记录时间准确
            Object.assign({ timestamp: Number(new Date()), clientTimestamp: Number(new Date()) }, data)
        );
        this.isInitialed && this.batchSend();
    }

    private canPush(data) {
        if (!this.ccloudAppId) {
            console.error("There is no ccloudAppId to report, refuse report!");
            return false;
        }
        if (!data) {
            console.error("There is no data to report, refuse report!");
            return false;
        }
        if (!data.class) {
            console.error("There is no data.class to report, refuse report!");
            return false;
        }
        if (!this.isInitialed) {
            console.warn("You'd better invoked init method before push, but continue report.");
        }
        if (this.disabledAppsFromCentralConfig.some((appId) => appId === this.ccloudAppId)) {
            console.warn("report disabled by server config");
            return false;
        }
        return true;
    }

    private batchSend() {
        this.debounce(this.send, this.debounceTime);
    }

    protected send() {
        if (this.infoArr.length <= 0) {
            return;
        }
        const widthCommonInfo = (infoArr) => {
            return infoArr.map((info) => ({
                ...this.commonInfo,
                sid: this.sid,
                ...info,
                ccloud_app_id: this.ccloudAppId,
                appkey: this.ccloudAppId,
            }));
        };
        try {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", `https://${this.baseUrl}/grail/api/report/raw`);
            xhr.setRequestHeader("Content-Type", "application/json");
            xhr.setRequestHeader("X-Data-Id", this.dataIndexId);
            xhr.responseType = "json";
            xhr.send(JSON.stringify(widthCommonInfo(this.infoArr)));
            this.infoArr = [];
        } catch (error) {
            console.error("send rum log error:\n", error);
        }
    }
}

function nanoid() {
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let nums = "";
    for (let i = 0; i < 32; i++) {
        const id = parseInt((Math.random() * 61).toString());
        nums += chars[id];
    }
    return nums;
}

function debounce() {
    let id;
    let start = null;
    return (func, time) => {
        let now = Date.now();
        if(now-start > time){
            func();
            start = now;
        }
        if (id) {
            clearTimeout(id);
        }
        id = setTimeout(() => {
            id = undefined;
            func();
        }, time);
    };
}

function uuid() {
    const uuidKey = "live-uuid";
    const id = localStorage.getItem(uuidKey);
    if (id && /^[0-9a-zA-Z]+$/.test(id)) {
        return id;
    } else {
        const newId = nanoid();
        localStorage.setItem(uuidKey, newId);
        return newId;
    }
}

class GrailReporter {
    private rumLogger;
    constructor(appKey, env) {
        this.rumLogger = new RumLogger({
            ccloudAppId: appKey,
            isTest: env !== "prod",
        });
    }

    initData(data){
        this.rumLogger.init(data);
    }

    push(data){
        const mid = uuid();
        this.rumLogger.push({ ...data, mid });
    }
}

window.GrailReporter = GrailReporter;