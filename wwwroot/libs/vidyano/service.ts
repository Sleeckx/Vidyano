import type * as Dto from "./typings/service.js"
import { Observable } from "./common/observable.js"
import "./common/array.js" // NOTE: We need the side effect from this import
import type { Application } from "./application.js"
import type { IClientOperation } from "./client-operations.js"
import { Language } from "./language.js"
import { PersistentObject } from "./persistent-object.js"
import { PersistentObjectAttribute } from "./persistent-object-attribute.js"
import { PersistentObjectAttributeAsDetail } from "./persistent-object-attribute-as-detail.js"
import { ActionDefinition } from "./action-definition.js"
import { ServiceHooks } from "./service-hooks.js"
import { cookie, cookiePrefix } from "./cookie.js"
import { NoInternetMessage } from "./no-internet-message.js"
import type { Query } from "./query.js"
import type { QueryResultItem } from "./query-result-item.js"
import { CultureInfo } from "./cultures.js"
import { ExecuteActionArgs } from "./execute-action-args.js"
import { DataType } from "./service-data-type.js"
import Boolean from "./common/boolean.js"
import "./actions.js"
import { sleep } from "./common/sleep.js"
import { fetchEventSource, EventSourceMessage } from '@microsoft/fetch-event-source'

/**
 * The version of this Vidyano client library.
 */
export const version = "vidyano-latest-version";

/**
 * Notification type used to indicate the kind of notification.
 * Valid values: "" (empty), "OK", "Notice", "Warning", "Error".
 */
export declare type NotificationType = Dto.NotificationType;

export type GetQueryOptions = {
    /** Indicates if the query is used as a lookup. (Optional) */
    asLookup?: boolean;
    /** Specifies column overrides. (Optional) */
    columnOverrides?: {
        /** The name of the column override. (Required) */
        name: string;
        /** Array of columns to include. (Optional) */
        includes?: string[];
        /** Array of columns to exclude. (Optional) */
        excludes?: string[];
    }[];
    /** The parent persistent object context. (Optional) */
    parent?: PersistentObject;
    /** A text search filter. (Optional) */
    textSearch?: string;
    /** Sorting options for the query. (Optional) */
    sortOptions?: string;
};

export class Service extends Observable<Service> {
    static #token: string;
    #lastAuthTokenUpdate: Date = new Date();
    #isUsingDefaultCredentials: boolean;
    #clientData: Dto.ClientData;
    #language: Language;
    #languages: Language[];
    #windowsAuthentication: boolean;
    #providers: { [name: string]: Dto.ProviderParameters };
    #isSignedIn: boolean;
    #application: Application;
    #userName: string;
    #authToken: string;
    #profile: boolean;
    #profiledRequests: Dto.ProfilerRequest[];
    #queuedClientOperations: IClientOperation[] = [];
    #initial: PersistentObject;
    staySignedIn: boolean;
    icons: Record<string, string>;
    actionDefinitions: Record<string, ActionDefinition> = {};
    environment: string = "Web";
    environmentVersion: string = "3";
    clearSiteData: boolean;

    /**
     * Creates a new instance of the Service.
     * @param serviceUri The base URI of the service.
     * @param hooks The service hooks for handling events.
     * @param isTransient Indicates if the service should be transient.
     */
    constructor(public serviceUri: string, public hooks: ServiceHooks = new ServiceHooks(), public readonly isTransient: boolean = false) {
        super();

        (<any>this.hooks)._service = this;

        if (!isTransient)
            this.staySignedIn = cookie("staySignedIn", { force: true }) === "true";
    }

    /**
     * Sets a static token for authentication.
     */
    static set token(token: string) {
        Service.#token = token;
    }

    /**
     * Constructs the full URL for a given service method.
     * Ensures that the base URI ends with a "/" before appending the method.
     * @param method The service method name.
     * @returns The full URL.
     */
    #createUri(method: string) {
        let uri = this.serviceUri;
        if (!String.isNullOrEmpty(uri) && !uri.endsWith("/"))
            uri += "/";
        return uri + method;
    }

    /**
     * Prepares the request payload for the given service method.
     * Attaches client version, environment, user credentials, session info, and language settings.
     * @param method The service method.
     * @param data Optional additional data.
     * @returns The complete request data.
     */
    #createData(method: string, data?: any) {
        data = data || {};

        data.clientVersion = version;
        data.environment = this.environment;
        data.environmentVersion = this.environmentVersion;

        if (method !== "getApplication") {
            data.userName = this.userName;
            if (data.userName !== this.defaultUserName)
                data.authToken = this.authToken;
        }

        const requestedLanguage = this.requestedLanguage;
        if (requestedLanguage != null)
            data.requestedLanguage = requestedLanguage;

        if (this.application && this.application.session)
            data.session = this.application.session.toServiceObject(true);

        if (this.profile)
            data.profile = true;

        this.hooks.createData(data);

        return data;
    }

    /**
     * Wraps the fetch call with retry logic on HTTP 429 (Too Many Requests) responses.
     * Retries the request based on the "Retry-After" header.
     * @param request The Request object.
     * @returns The Response from fetch.
     */
    async #fetch(request: Request): Promise<Response> {
        let response: Response;

        do {
            response = await this.hooks.onFetch(request);
            if (response.status !== 429)
                return response;

            const retryAfter = response.headers?.get("Retry-After") || "5";
            let seconds = parseInt(retryAfter) * 1000;
            if (Number.isNaN(seconds)) {
                const when = new Date(retryAfter).getTime();
                if (!Number.isNaN(when))
                    seconds = Math.max(0, when - new Date().getTime());
            }

            await sleep(seconds || 5000);
        }
        while (true);
    }

    /**
     * Performs a GET request and returns the parsed JSON response.
     * @param url The URL to fetch.
     * @param headers Optional headers for the request.
     * @returns The parsed JSON data.
     */
    async #getJSON(url: string, headers?: any): Promise<any> {
        const request = new Request(url, {
            method: "GET",
            headers: headers != null ? new Headers(headers) : undefined
        });

        try {
            const response = await this.#fetch(request);
            if (response.ok)
                return await response.json();

            throw response.text;
        }
        catch (e) {
            throw e || (NoInternetMessage.messages[navigator.language.split("-")[0].toLowerCase()] || NoInternetMessage.messages["en"]).message;
        }
    }

    /**
     * Performs a POST request with JSON data. Supports both normal and streaming posts.
     * Handles response parsing, session expiration, and profiling.
     * @param url The endpoint URL.
     * @param data The data to be sent.
     * @returns The parsed JSON result.
     */
    async #postJSON(url: string, data: any): Promise<any> {
        const createdRequest = new Date();
        let requestStart: number;
        let requestMethod: string;

        if (this.profile) {
            requestStart = window.performance.now();
            requestMethod = url.split("/").pop();
        }

        const headers = new Headers();
        if (this.authTokenType === "JWT") {
            headers.set("Authorization", "bearer " + this.authToken.substring(4));

            if (data) {
                delete data.userName;
                delete data.authToken;
            }
        }

        let body: any;
        if (!data.__form_data) {
            headers.append("Content-type", "application/json");
            body = JSON.stringify(data);
        }
        else {
            const formData = data.__form_data as FormData;
            delete data.__form_data;
            formData.set("data", JSON.stringify(data));
            body = formData;
        }

        // Streaming post: if the action is flagged as streaming, use fetchEventSource to process streamed events.
        if (typeof data.action === "string") {
            const action = data.action.split(".", 2).pop();
            const definition = this.actionDefinitions[action];
            if (definition?.isStreaming) {
                let cancel: () => void;
                let signal: (e?: unknown) => void;

                let awaiter = new Promise((resolve, reject) => {
                    signal = resolve;
                    cancel = reject;
                });

                const abortController = new AbortController();
                const messages: EventSourceMessage[] = [];
                const iterator = async function* () {
                    try {
                        while(true) {
                            await awaiter;

                            while (messages.length > 0) {
                                const message = messages.shift();
                                if (!!message.data) // Ignore keep-alive messages
                                    yield message.data;
                            }
                        }
                    }
                    catch { /* Ignore */ }
                };

                this.hooks.onStreamingAction(action, iterator, () => abortController.abort());

                fetchEventSource(url, {
                    method: "POST",
                    headers: Array.from(headers.entries()).reduce((headers, [key, value]) => {
                        headers[key] = value;
                        return headers;
                    }, {}),
                    body: body,
                    signal: abortController.signal,
                    onmessage: (e: EventSourceMessage) => {
                        messages.push(e);
                        signal();

                        awaiter = new Promise((resolve, reject) => {
                            signal = resolve;
                            cancel = reject;
                        });
                    },
                    onclose: () => cancel(),
                    onerror: () => {
                        cancel();
                        return null;
                    },
                    openWhenHidden: true
                });

                // Ensure the parent is busy until the first message arrives.
                await awaiter;

                return;
            }
        }

        // Normal post: send a standard JSON POST request.
        try {
            const response = await this.#fetch(new Request(url, {
                method: "POST",
                headers: headers,
                body: body
            }));

            if (!response.ok)
                throw response.statusText;

            let result: any;
            if (response.headers.get("content-type")?.contains("application/json"))
                result = await response.json();
            else if (response.headers.get("content-type") === "text/html") {
                const regex = /({(.*)+)</gm;
                result = JSON.parse(regex.exec(await response.text())[1]);
            }   
            else
                throw "Invalid content-type";

            try {
                if (result.exception == null)
                    result.exception = result.ExceptionMessage;

                if (result.exception == null) {
                    if (createdRequest > this.#lastAuthTokenUpdate && this.authTokenType !== "JWT") {
                        this.authToken = result.authToken;
                        this.#lastAuthTokenUpdate = createdRequest;
                    }

                    if (this.application)
                        this.application._updateSession(result.session);

                    return result;
                } else if (result.exception === "Session expired") {
                    this.authToken = null;
                    delete data.authToken;

                    if (this.defaultUserName && this.defaultUserName === this.userName) {
                        delete data.password;
                        return await this.#postJSON(url, data);
                    } else if (!await this.hooks.onSessionExpired())
                        throw result.exception;
                    else if (this.defaultUserName) {
                        delete data.password;
                        data.userName = this.defaultUserName;

                        return await this.#postJSON(url, data);
                    }
                    else
                        throw result.exception;
                }
                else
                    throw result.exception;
            }
            finally {
                this.#postJSONProcess(data, result, requestMethod, createdRequest, requestStart, result.profiler ? response.headers.get("X-ElapsedMilliseconds") : undefined);
            }
        }
        catch (e) {
            throw e || (NoInternetMessage.messages[navigator.language.split("-")[0].toLowerCase()] || NoInternetMessage.messages["en"]).message;
        }
    }

    /**
     * Processes profiling information and queued client operations from the server response.
     * Notifies client operations and stores profiler data if profiling is enabled.
     * @param data The request data.
     * @param result The result returned by the server.
     * @param requestMethod The invoked method name.
     * @param createdRequest The timestamp when the request was created.
     * @param requestStart The timestamp when the request started (for profiling).
     * @param elapsedMs Elapsed milliseconds reported by the server.
     */
    #postJSONProcess(data: any, result: any, requestMethod: string, createdRequest: Date, requestStart: number, elapsedMs: string) {
        if (this.profile && result.profiler) {
            const requestEnd = window.performance.now();

            if (!result.profiler) {
                result.profiler = { elapsedMilliseconds: -1 };
                if (result.exception)
                    result.profiler.exceptions = [result.exception];
            }

            if (elapsedMs)
                result.profiler.elapsedMilliseconds = Service.fromServiceString(elapsedMs, "Int32");

            const request: Dto.ProfilerRequest = {
                when: createdRequest,
                profiler: result.profiler,
                transport: Math.round(requestEnd - requestStart - result.profiler.elapsedMilliseconds),
                method: requestMethod,
                request: data,
                response: result
            };

            const requests = this.profiledRequests || [];
            requests.unshift(request);

            this.#setProfiledRequests(requests.slice(0, 20));
        }

        if (result.operations) {
            this.#queuedClientOperations.push(...result.operations);
            result.operations = null;
        }

        if (this.#queuedClientOperations.length > 0) {
            setTimeout(() => {
                let operation: IClientOperation;
                while (operation = this.#queuedClientOperations.splice(0, 1)[0])
                    this.hooks.onClientOperation(operation);
            }, 0);
        }
    }

    /**
     * Gets the queued client operations.
     */
    get queuedClientOperations(): IClientOperation[] {
        return this.#queuedClientOperations;
    }

    /**
     * Gets the current application instance.
     */
    get application(): Application {
        return this.#application;
    }

    /**
     * Sets the current application instance and updates profiling settings based on its capabilities.
     * @param application The new Application instance.
     */
    #setApplication(application: Application) {
        if (this.#application === application)
            return;

        const oldApplication = this.#application;
        this.notifyPropertyChanged("application", this.#application = application, oldApplication);

        if (this.#application && this.#application.canProfile)
            this.profile = !!Boolean.parse(cookie("profile"));
        else
            this.profile = false;
    }

    /**
     * Gets the initial persistent object.
     */
    get initial(): PersistentObject {
        return this.#initial;
    }

    /**
     * Gets or sets the current language.
     */
    get language(): Language {
        return this.#language;
    }

    set language(l: Language) {
        if (this.#language === l)
            return;

        const oldLanguage = this.#language;
        this.notifyPropertyChanged("language", this.#language = l, oldLanguage);
    }

    /**
     * Gets or sets the requested language.
     */
    get requestedLanguage(): string {
        return cookie("requestedLanguage");
    }

    set requestedLanguage(val: string) {
        if (this.requestedLanguage === val)
            return;

        cookie("requestedLanguage", val);
    }

    /**
     * Gets a value indicating whether the user is signed in.
     */
    get isSignedIn(): boolean {
        return this.#isSignedIn;
    }

    /**
     * Updates the signed-in status and notifies any observers.
     * Also updates the flag indicating whether default credentials are used.
     * @param val The new sign-in status.
     */
    #setIsSignedIn(val: boolean) {
        const oldIsSignedIn = this.#isSignedIn;
        this.#isSignedIn = val;

        const oldIsUsingDefaultCredentials = this.#isUsingDefaultCredentials;
        this.#isUsingDefaultCredentials = this.defaultUserName && this.userName && this.defaultUserName.toLowerCase() === this.userName.toLowerCase();

        if (oldIsSignedIn !== this.#isSignedIn)
            this.notifyPropertyChanged("isSignedIn", this.#isSignedIn, oldIsSignedIn);

        if (oldIsSignedIn !== this.#isUsingDefaultCredentials)
            this.notifyPropertyChanged("isUsingDefaultCredentials", this.#isUsingDefaultCredentials, oldIsUsingDefaultCredentials);
    }

    /**
     * Gets the list of available languages.
     */
    get languages(): Language[] {
        return this.#languages;
    }

    /**
     * Gets a value indicating whether Windows authentication is used.
     */
    get windowsAuthentication(): boolean {
        return this.#windowsAuthentication;
    }

    /**
     * Gets the provider parameters.
     */
    get providers(): { [name: string]: Dto.ProviderParameters } {
        return this.#providers;
    }

    /**
     * Gets a value indicating whether default credentials are used.
     */
    get isUsingDefaultCredentials(): boolean {
        return this.#isUsingDefaultCredentials;
    }

    /**
     * Gets the current user name.
     */
    get userName(): string {
        return !this.isTransient ? cookie("userName") : this.#userName;
    }

    private set userName(val: string) {
        const oldUserName = this.userName;
        if (oldUserName === val)
            return;

        if (!this.isTransient)
            cookie("userName", val, { expires: this.staySignedIn ? 365 : 30 });
        else
            this.#userName = val;

        this.notifyPropertyChanged("userName", val, oldUserName);
    }

    /**
     * Gets the default user name.
     */
    get defaultUserName(): string {
        return !!this.#clientData ? this.#clientData.defaultUser || null : null;
    }

    /**
     * Gets the user name for calling the Register persistent object.
     */
    get registerUserName(): string {
        return !!this.#providers && this.#providers["Vidyano"] ? this.#providers["Vidyano"].registerUser || null : null;
    }

    /**
     * Gets or sets the authentication token.
     */
    get authToken(): string {
        return !this.isTransient ? cookie("authToken") : this.#authToken;
    }

    set authToken(val: string) {
        if (!this.isTransient) {
            const oldAuthToken = this.authToken;

            if (this.staySignedIn)
                cookie("authToken", val, { expires: 14 });
            else
                cookie("authToken", val);

            if (!oldAuthToken && val) {
                localStorage.setItem("vi-setAuthToken", JSON.stringify({ cookiePrefix: cookiePrefix(), authToken: val }));
                localStorage.removeItem("vi-setAuthToken");
            }
        }
        else
            this.#authToken = val;
    }

    /**
     * Gets the type of the authentication token.
     */
    get authTokenType(): "Basic" | "JWT" | null {
        if (!this.authToken)
            return null;

        return this.authToken.startsWith("JWT:") ? "JWT" : "Basic";
    }

    /**
     * Gets or sets whether profiling is enabled.
     */
    get profile(): boolean {
        return this.#profile;
    }

    set profile(val: boolean) {
        if (this.#profile === val)
            return;

        const currentProfileCookie = !!Boolean.parse(cookie("profile"));
        if (currentProfileCookie !== val)
            cookie("profile", String(val));

        const oldValue = this.#profile;
        this.#profile = val;

        if (!val)
            this.#setProfiledRequests([]);

        this.notifyPropertyChanged("profile", val, oldValue);
    }

    /**
     * Gets the list of profiled requests.
     */
    get profiledRequests(): Dto.ProfilerRequest[] {
        return this.#profiledRequests;
    }

    /**
     * Updates the stored profiler requests and notifies observers.
     * @param requests The new list of profiler requests.
     */
    #setProfiledRequests(requests: Dto.ProfilerRequest[]) {
        this.notifyPropertyChanged("profiledRequests", this.#profiledRequests = requests);
    }

    /**
     * Returns a translated message for the given key and parameters.
     * @param key The message key.
     * @param params The parameters to format the message.
     */
    getTranslatedMessage(key: string, ...params: string[]): string {
        return String.format.apply(null, [this.language.messages[key] || key].concat(params));
    }

    /**
     * Retrieves the credential type for the specified user name.
     * @param userName The user name.
     */
    async getCredentialType(userName: string) {
        return this.#postJSON("authenticate/GetCredentialType", { userName: userName });
    }

    /**
     * Initializes the service.
     * @param skipDefaultCredentialLogin Whether to skip default credential login.
     */
    async initialize(skipDefaultCredentialLogin: boolean = false): Promise<Application> {
        let url = "GetClientData?v=3";
        if (this.requestedLanguage)
            url = `${url}&lang=${this.requestedLanguage}`;

        this.#clientData = await this.hooks.onInitialize(await this.#getJSON(this.#createUri(url)));

        if (this.#clientData.exception)
            throw this.#clientData.exception;

        const languages = Object.keys(this.#clientData.languages).map(culture => new Language(this.#clientData.languages[culture], culture));
        this.hooks.setDefaultTranslations(languages);

        this.#languages = languages;
        this.language = this.#languages.find(l => l.isDefault) || this.#languages[0];

        this.#providers = {};
        for (const provider in this.#clientData.providers) {
            this.#providers[provider] = this.#clientData.providers[provider].parameters;
        }
        this.#windowsAuthentication = this.#clientData.windowsAuthentication;

        if (Service.#token) {
            if (!Service.#token.startsWith("JWT:")) {
                const tokenParts = Service.#token.split("/", 2);

                this.userName = atob(tokenParts[0]);
                this.authToken = tokenParts[1].replace("_", "/");
            }
            else
                this.authToken = Service.#token;

            Service.#token = undefined;

            const returnUrl = cookie("returnUrl", { force: true }) || "";
            if (returnUrl)
                cookie("returnUrl", null, { force: true });

            this.hooks.onNavigate(returnUrl, true);

            return this.#getApplication();
        }

        this.userName = this.userName || this.#clientData.defaultUser;

        let application: Application;
        if (!String.isNullOrEmpty(this.authToken) || ((this.#clientData.defaultUser || this.windowsAuthentication) && !skipDefaultCredentialLogin)) {
            try {
                application = await this.#getApplication();
            }
            catch (e) {
                application = null;
            }
        }
        else
            this.#setIsSignedIn(!!this.application);

        return application;
    }

    /**
     * Initiates sign-in using an external provider.
     * @param providerName The provider name.
     */
    signInExternal(providerName: string) {
        if (!this.providers[providerName] || !this.providers[providerName].requestUri)
            throw "Provider not found or not flagged for external authentication.";

        document.location.href = this.providers[providerName].requestUri;
    }

    /**
     * Signs in using user credentials.
     * @param userName The user name.
     * @param password The password.
     * @param staySignedIn Whether to stay signed in.
     */
    async signInUsingCredentials(userName: string, password: string, staySignedIn?: boolean): Promise<Application>;

    /**
     * Signs in using user credentials with a verification code.
     * @param userName The user name.
     * @param password The password.
     * @param code The verification code.
     * @param staySignedIn Whether to stay signed in.
     */
    async signInUsingCredentials(userName: string, password: string, code?: string, staySignedIn?: boolean): Promise<Application>;
    async signInUsingCredentials(userName: string, password: string, codeOrStaySignedIn?: string | boolean, staySignedIn?: boolean): Promise<Application> {
        this.userName = userName;

        const data = this.#createData("getApplication");
        data.userName = userName;
        data.password = password;

        if (typeof codeOrStaySignedIn === "string")
            data.code = codeOrStaySignedIn;

        try {
            const application = await this.#getApplication(data);
            if (application && this.isSignedIn && !this.isTransient) {
                const ssi = (typeof codeOrStaySignedIn === "boolean" && codeOrStaySignedIn) || (typeof staySignedIn === "boolean" && staySignedIn);
                cookie("staySignedIn", (this.staySignedIn = ssi) ? "true" : null, { force: true, expires: 365 });
            }

            return application;
        }
        catch (e) {
            throw e;
        }
    }

    /**
     * Signs in using default credentials.
     */
    signInUsingDefaultCredentials(): Promise<Application> {
        this.userName = this.defaultUserName;

        return this.#getApplication();
    }

    /**
     * Signs the user out.
     * @param skipAcs Whether to skip ACS sign-out.
     */
    signOut(skipAcs?: boolean): Promise<boolean> {
        if (this.clearSiteData && !!this.authToken)
            this.executeAction("PersistentObject.viSignOut", this.application, null, null, null, true);

        if (this.userName === this.defaultUserName || this.userName === this.registerUserName || this.clearSiteData)
            this.userName = null;

        this.authToken = null;
        this.#setApplication(null);

        if (!skipAcs && this.#providers["Acs"] && this.#providers["Acs"].signOutUri) {
            return new Promise(resolve => {
                const iframe = document.createElement("iframe");
                iframe.setAttribute("hidden", "");
                iframe.width = "0";
                iframe.height = "0";
                iframe.src = this.#providers["Acs"].signOutUri;
                iframe.onload = () => {
                    document.body.removeChild(iframe);
                    this.#setIsSignedIn(false);

                    resolve(true);
                };
                iframe.onerror = () => {
                    this.#setIsSignedIn(false);
                    resolve(true);
                };

                document.body.appendChild(iframe);
            });
        }

        this.clearSiteData = false;
        this.#setIsSignedIn(false);
        return Promise.resolve(true);
    }

    /**
     * Retrieves the application data from the server.
     * Handles session management and language updates.
     * @param data Optional data for the request.
     * @returns The Application instance.
     */
    async #getApplication(data: any = this.#createData("")): Promise<Application> {
        if (!(data.authToken || data.accessToken || data.password) && this.userName && this.userName !== this.defaultUserName && this.userName !== this.registerUserName) {
            if (this.defaultUserName)
                this.userName = this.defaultUserName;

            if (!this.userName && !this.hooks.onSessionExpired())
                throw "Session expired";

            data.userName = this.userName;
        }

        const result = await this.#postJSON(this.#createUri("GetApplication"), data);

        if (!String.isNullOrEmpty(result.exception))
            throw result.exception;

        if (result.application == null)
            throw "Unknown error";

        this.#setApplication(this.hooks.onConstructApplication(result));

        const resourcesQuery = this.application.getQuery("Resources");
        this.icons = resourcesQuery ? Object.assign({}, ...resourcesQuery.items.filter(i => i.getValue("Type") === "Icon").map(i => ({ [i.getValue("Key")]: i.getValue("Data") }))) : {};

        Object.assign(this.actionDefinitions, ...this.application.getQuery("Actions").items.map(i => ({ [i.getValue("Name")]: new ActionDefinition(this, i) })));

        this.language = this.#languages.find(l => l.culture === result.userLanguage) || this.#languages.find(l => l.isDefault);

        const clientMessagesQuery = this.application.getQuery("ClientMessages");
        if (clientMessagesQuery) {
            const newMessages = { ...this.language.messages };
            clientMessagesQuery.items.forEach(msg => newMessages[msg.getValue("Key")] = msg.getValue("Value"));

            this.notifyPropertyChanged("language.messages", this.language.messages = newMessages, this.language.messages);
        }

        Object.keys(this.actionDefinitions).forEach(name => this.language.messages[`Action_${name}`] = this.actionDefinitions[name].displayName);

        CultureInfo.currentCulture = CultureInfo.cultures[result.userCultureInfo] || CultureInfo.cultures[result.userLanguage] || CultureInfo.invariantCulture;

        if (result.initial != null)
            this.#initial = this.hooks.onConstructPersistentObject(this, result.initial);

        if (result.userName !== this.registerUserName || result.userName === this.defaultUserName) {
            this.userName = result.userName;

            if (result.session)
                this.application._updateSession(result.session);

            this.#setIsSignedIn(true);
        }
        else
            this.#setIsSignedIn(false);

        return this.application;
    }

    /**
     * Retrieves a query.
     * @param id The query identifier.
     * @param options Query options.
     */
    async getQuery(id: string, options?: GetQueryOptions): Promise<Query>;

    /**
     * Retrieves a query with lookup options.
     * @param id The query identifier.
     * @param asLookup Whether it's a lookup query.
     * @param parent The parent persistent object.
     * @param textSearch Text search criteria.
     * @param sortOptions Sorting options.
     */
    async getQuery(id: string, asLookup?: boolean, parent?: PersistentObject, textSearch?: string, sortOptions?: string): Promise<Query>;
    async getQuery(id: string, arg2?: boolean | GetQueryOptions, parent?: PersistentObject, textSearch?: string, sortOptions?: string): Promise<Query> {
        const data = this.#createData("getQuery");
        data.id = id;

        const options = typeof arg2 === "object" ? arg2 : {
            asLookup: arg2,
            parent,
            textSearch,
            sortOptions
        };

        if (options.parent != null)
            data.parent = options.parent.toServiceObject();

        if (!!options.textSearch)
            data.textSearch = options.textSearch;

        if (!!options.sortOptions)
            data.sortOptions = options.sortOptions;

        if (!!options.columnOverrides)
            data.columnOverrides = options.columnOverrides;

        const result = await this.#postJSON(this.#createUri("GetQuery"), data);
        if (result.exception)
            throw result.exception;

        return this.hooks.onConstructQuery(this, result.query, null, options.asLookup);
    }

    /**
     * Retrieves a persistent object.
     * @param parent The parent persistent object.
     * @param id The persistent object type identifier.
     * @param objectId The object identifier.
     * @param isNew Whether the object is new.
     */
    async getPersistentObject(parent: PersistentObject, id: string, objectId?: string, isNew?: boolean): Promise<PersistentObject> {
        const data = this.#createData("getPersistentObject");
        data.persistentObjectTypeId = id;
        data.objectId = objectId;
        if (isNew)
            data.isNew = isNew;
        if (parent != null)
            data.parent = parent.toServiceObject();

        const result = await this.#postJSON(this.#createUri("GetPersistentObject"), data);
        if (result.exception)
            throw result.exception;
        else if (result.result && result.result.notification) {
            if (result.result.notificationDuration) {
                this.hooks.onShowNotification(result.result.notification, result.result.notificationType, result.result.notificationDuration);
                result.result.notification = null;
                result.result.notificationDuration = 0;
            }
            else if (result.result.notificationType === "Error")
                throw result.result.notification;
        }

        return this.hooks.onConstructPersistentObject(this, result.result);
    }

    /**
     * Executes a query.
     * @param parent The parent persistent object.
     * @param query The query to execute.
     * @param asLookup Whether it's a lookup query.
     * @param throwExceptions Whether to throw exceptions.
     */
    async executeQuery(parent: PersistentObject, query: Query, asLookup: boolean = false, throwExceptions?: boolean): Promise<Dto.QueryResult> {
        const data = this.#createData("executeQuery");
        data.query = query._toServiceObject();

        if (parent != null)
            data.parent = parent.toServiceObject();
        if (asLookup)
            data.asLookup = asLookup;
        if (query.ownerAttributeWithReference)
            data.forReferenceAttribute = query.ownerAttributeWithReference.name;

        try {
            const result = await this.#postJSON(this.#createUri("ExecuteQuery"), data);
            if (result.exception)
                throw result.exception;

            const queryResult = <Dto.QueryResult>result.result;
            if (queryResult.continuation) {
                const wanted = <number>data.query.top || queryResult.pageSize;

                while (queryResult.continuation && queryResult.items.length < wanted) {
                    data.query.continuation = queryResult.continuation;
                    data.query.top = wanted - queryResult.items.length;

                    const innerResult = await this.#postJSON(this.#createUri("ExecuteQuery"), data);
                    if (innerResult.exception)
                        throw innerResult.exception;

                    const innerQueryResult = <Dto.QueryResult>innerResult.result;
                    queryResult.items.push(...innerQueryResult.items);
                    queryResult.continuation = innerQueryResult.continuation;
                }

                if (!queryResult.continuation)
                    queryResult.totalItems = query.items.length + queryResult.items.length;
            }

            return queryResult;
        }
        catch (e) {
            query.setNotification(e);

            if (throwExceptions)
                throw e;
        }
    }

    /**
     * Executes an action.
     * @param action The action name.
     * @param parent The parent persistent object.
     * @param query The query context.
     * @param selectedItems The selected query result items.
     * @param parameters Additional parameters.
     * @param skipHooks Whether to skip hooks.
     */
    async executeAction(action: string, parent: PersistentObject, query: Query, selectedItems: Array<QueryResultItem>, parameters?: any, skipHooks: boolean = false): Promise<PersistentObject> {
        const isObjectAction = action.startsWith("PersistentObject.") || query == null;
        const targetServiceObject = isObjectAction ? parent : query;

        if (!skipHooks) {
            targetServiceObject.setNotification();

            // Clear selected items if all are selected and not inverse
            if (!isObjectAction && query.selectAll.allSelected && !query.selectAll.inverse)
                selectedItems = [];

            this.hooks.trackEvent(action, parameters ? parameters.MenuLabel || parameters.MenuOption : null, query || parent);

            const args = new ExecuteActionArgs(this, action, parent, query, selectedItems, parameters);
            try {
                await this.hooks.onAction(args);
                if (args.isHandled)
                    return args.result;

                return await this.executeAction(action, parent, query, selectedItems, args.parameters, true);
            }
            catch (e) {
                targetServiceObject.setNotification(e);
                throw e;
            }
        }

        const isFreezingAction = isObjectAction && action !== "PersistentObject.Refresh";
        const data = this.#createData("executeAction");
        data.action = action;
        if (parent != null)
            data.parent = parent.toServiceObject();
        if (query != null)
            data.query = query._toServiceObject();
        if (selectedItems != null)
            data.selectedItems = selectedItems.map(item => item && item._toServiceObject());
        if (parameters != null)
            data.parameters = parameters;

        const executeThen: (result: any) => Promise<PersistentObject> = async result => {
            if (!result)
                return;

            if (result.operations) {
                this.#queuedClientOperations.push(...result.operations);
                result.operations = null;
            }

            if (!result.retry)
                return result.result ? await this.hooks.onConstructPersistentObject(this, result.result) : null;

            if (result.retry.persistentObject)
                result.retry.persistentObject = this.hooks.onConstructPersistentObject(this, result.retry.persistentObject);

            const option = await this.hooks.onRetryAction(result.retry);
            (data.parameters || (data.parameters = {})).RetryActionOption = option;

            if (result.retry.persistentObject instanceof PersistentObject)
                data.retryPersistentObject = result.retry.persistentObject.toServiceObject();

            const retryResult = await this.#postJSON(this.#createUri("ExecuteAction"), data);
            return await executeThen(retryResult);
        };

        try {
            if (isFreezingAction)
                parent?.freeze();

            const getInputs = (result: [attributeName: string, input: HTMLInputElement][], attribute: PersistentObjectAttribute) => {
                if (attribute.input != null && attribute.isValueChanged) {
                    result.push([
                        !attribute.parent.ownerDetailAttribute ? attribute.name : `${attribute.parent.ownerDetailAttribute.name}.${attribute.parent.ownerDetailAttribute.objects.indexOf(attribute.parent)}.${attribute.name}`,
                        attribute.input
                    ]);
                }
                else if (attribute instanceof PersistentObjectAttributeAsDetail)
                    attribute.objects?.flatMap(parent => parent.attributes).reduce(getInputs, result);

                return result;
            };

            const inputs = parent?.attributes.reduce(getInputs, []);
            if (inputs?.length > 0) {
                const formData = new FormData();
                inputs.forEach(i => {
                    const [attributeName, input] = i;
                    formData.set(attributeName, input.files[0]);
                });

                data.__form_data = formData;
            }

            const result = await this.#postJSON(this.#createUri("ExecuteAction"), data);
            return await executeThen(result);
        }
        catch (e) {
            targetServiceObject.setNotification(e);

            throw e;
        }
        finally {
            if (isFreezingAction)
                parent?.unfreeze();
        }
    }

    /**
     * Retrieves a data stream.
     * @param obj The persistent object.
     * @param action The action name.
     * @param parent The parent persistent object.
     * @param query The query context.
     * @param selectedItems The selected query result items.
     * @param parameters Additional parameters.
     */
    async getStream(obj: PersistentObject, action?: string, parent?: PersistentObject, query?: Query, selectedItems?: Array<QueryResultItem>, parameters?: any) {
        const data = this.#createData("getStream");
        data.action = action;
        if (obj != null)
            data.id = obj.objectId;
        if (parent != null)
            data.parent = parent.toServiceObject();
        if (query != null)
            data.query = query._toServiceObject();
        if (selectedItems != null)
            data.selectedItems = selectedItems.map(si => si._toServiceObject());
        if (parameters != null)
            data.parameters = parameters;

        const formData = new FormData();
        formData.append("data", JSON.stringify(data));

        const response = await this.#fetch(new Request(this.#createUri("GetStream"), {
            body: formData,
            method: "POST"
        }));

        if (response.ok) {
            const blob = await response.blob();
            
            const a = document.createElement("a");
            a.style.display = "none";
            
            const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
            const matches = filenameRegex.exec(response.headers.get("Content-Disposition"));
            if (matches != null && matches[1])
                a.download = matches[1].replace(/['"]/g, '');

            a.href = URL.createObjectURL(blob);
            document.body.appendChild(a);
            a.dispatchEvent(new MouseEvent("click", { bubbles: false }));
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
        }
    }

    /**
     * Retrieves a report.
     * @param token The report token.
     * @param options Report options.
     */
    async getReport(token: string, { filter = "", orderBy, top, skip, hideIds, hideType = true }: IReportOptions = {}): Promise<any[]> {
        let uri = this.#createUri(`GetReport/${token}?format=json&$filter=${encodeURIComponent(filter)}`);

        if (orderBy)
            uri = `${uri}&$orderBy=${orderBy}`;
        if (top)
            uri = `${uri}&$top=${top}`;
        if (skip)
            uri = `${uri}&$skip=${skip}`;
        if (hideIds)
            uri = `${uri}&hideIds=true`;
        if (hideType)
            uri = `${uri}&hideType=true`;

        return (await this.#getJSON(uri)).d;
    }

    /**
     * Performs an instant search.
     * @param search The search text.
     */
    async getInstantSearch(search: string): Promise<IInstantSearchResult[]> {
        const uri = this.#createUri(`Instant?q=${encodeURIComponent(search)}`);

        let authorization: string;
        if (this.authTokenType !== "JWT") {
            const userName = encodeURIComponent(this.userName);
            const authToken = this.authToken ? this.authToken.replace("/", "_") : "";

            authorization = `${userName}/${authToken}`;
        }
        else
            authorization = this.authToken.substr(4);

        return (await this.#getJSON(uri, {
            "Authorization": `Bearer ${authorization}`
        })).d;
    }

    /**
     * Initiates the forgot password process.
     * @param userName The user name.
     */
    forgotPassword(userName: string): Promise<IForgotPassword> {
        return this.#postJSON(this.#createUri("forgotpassword"), { userName: userName });
    }

    /**
     * Converts a service string representation to its corresponding data type.
     * @param value The service string.
     * @param typeName The target type name.
     * @returns The converted value.
     */
    static fromServiceString(value: string, typeName: string): any {
        return DataType.fromServiceString(value, typeName);
    }

    /**
     * Converts a value to its service string representation based on the type.
     * @param value The value to convert.
     * @param typeName The type name.
     * @returns The service string.
     */
    static toServiceString(value: any, typeName: string): string {
        return DataType.toServiceString(value, typeName);
    }
}

export type IForgotPassword = {
    /** The message to be displayed to the user */
    notification: string;
    /** The type of notification (e.g., "", "OK", "Notice", "Warning", "Error") */
    notificationType: NotificationType;
    /** The duration in milliseconds for which the notification should be shown */
    notificationDuration: number;
};

export type IReportOptions = {
    /** Optional filter string to limit report data */
    filter?: string;
    /** Optional clause to specify the sort order of the report data */
    orderBy?: string;
    /** Optional limit on the number of items to retrieve */
    top?: number;
    /** Optional number of items to skip in the report */
    skip?: number;
    /** Optional flag to hide ID fields in the report */
    hideIds?: boolean;
    /** Optional flag to hide type information in the report */
    hideType?: boolean;
};

export type IInstantSearchResult = {
    /** The unique identifier for the search result */
    id: string;
    /** The display label for the search result */
    label: string;
    /** The associated object identifier */
    objectId: string;
    /** A breadcrumb path representing the hierarchical location of the search result */
    breadcrumb: string;
};