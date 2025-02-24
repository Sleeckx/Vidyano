import type * as Dto from "./typings/service.js"
import type { KeyValuePair } from "./typings/common.js"
import type { PersistentObject } from "./persistent-object.js"
import type { PersistentObjectAttributeTab } from "./persistent-object-tab.js"
import type { Service } from "./service.js"
import { ServiceObject } from "./service-object.js"
import { CultureInfo } from "./cultures.js"
import type { PersistentObjectAttributeGroup } from "./persistent-object-attribute-group.js"
import type { PersistentObjectAttributeWithReference } from "./persistent-object-attribute-with-reference.js"
import { Action } from "./action.js"
import { PersistentObjectAttributeSymbols, PersistentObjectSymbols } from "./advanced.js"
import { DataType } from "./service-data-type.js"

export type PersistentObjectAttributeOption = KeyValuePair<string, string>;
export class PersistentObjectAttribute extends ServiceObject {
    #input: HTMLInputElement;
    #actions: Array<Action> & Record<string, Action>;

    #label: string;
    readonly #isSystem: boolean;
    #lastParsedValue: string;
    #cachedValue: any;
    #serviceValue: string;
    #serviceOptions: string[];
    #displayValueSource: any;
    #displayValue: string;
    #rules: string;
    #validationError: string;
    #tab: PersistentObjectAttributeTab;
    #tabKey: string;
    #group: PersistentObjectAttributeGroup;
    #groupKey: string;
    #isRequired: boolean;
    #isReadOnly: boolean;
    #isValueChanged: boolean;
    readonly #isSensitive: boolean;
    #visibility: Dto.PersistentObjectAttributeVisibility;
    #isVisible: boolean;
    #tag: any;

    protected _shouldRefresh: boolean = false;
    #refreshServiceValue: string;

    readonly #id: string;
    readonly #name: string;
    options: string[] | PersistentObjectAttributeOption[];
    #offset: number;
    readonly #type: string;
    readonly toolTip: string;
    typeHints: any;
    triggersRefresh: boolean;
    readonly #column: number;
    readonly #columnSpan: number;

    constructor(service: Service, attr: Dto.PersistentObjectAttribute, public parent: PersistentObject) {
        super(service);

        this[PersistentObjectAttributeSymbols.BackupServiceValue] = this.#backupServiceValue.bind(this);
        this[PersistentObjectAttributeSymbols.IsPersistentObjectAttribute] = true;
        this[PersistentObjectAttributeSymbols.RefreshFromResult] = this._refreshFromResult.bind(this);
        this[PersistentObjectAttributeSymbols.ToServiceObject] = this._toServiceObject.bind(this);

        this.#id = attr.id;
        this.#isSystem = !!attr.isSystem;
        this.#name = attr.name;
        this.#type = attr.type;
        this.#label = attr.label;
        this.#serviceValue = attr.value !== undefined ? attr.value : null;
        this.#groupKey = attr.group;
        this.#tabKey = attr.tab;
        this.#isReadOnly = !!attr.isReadOnly;
        this.#isRequired = !!attr.isRequired;
        this.#isValueChanged = !!attr.isValueChanged;
        this.#isSensitive = !!attr.isSensitive;
        this.#offset = attr.offset || 0;
        this.toolTip = attr.toolTip;
        this.#rules = attr.rules;
        this.validationError = attr.validationError || null;
        this.typeHints = attr.typeHints || {};
        this.triggersRefresh = !!attr.triggersRefresh;
        this.#column = attr.column;
        this.#columnSpan = attr.columnSpan || 0;
        this.visibility = attr.visibility;
        this.#tag = attr.tag;

        if (this.type !== "Reference")
            this._setOptions(attr.options);

        if (this.type === "BinaryFile") {
            const input = document?.createElement("input");
            input.type = "file";
            input.accept = this.getTypeHint("accept", null);

            this.#input = input;
        }

        this.#actions = <any>[];
        Action.addActions(this.service, this.parent, this.#actions, attr.actions || []);
    }

    get id(): string {
        return this.#id;
    }

    get name() {
        return this.#name;
    }

    get type() {
        return this.#type;
    }

    get label(): string {
        return this.#label;
    }

    set label(label: string) {
        const oldLabel = this.#label;
        if (oldLabel !== label)
            this.notifyPropertyChanged("label", this.#label = label, oldLabel);
    }

    get groupKey(): string {
        return this.#groupKey;
    }

    get group(): PersistentObjectAttributeGroup {
        return this.#group;
    }
    set group(group: PersistentObjectAttributeGroup) {
        const oldGroup = this.#group;
        this.#group = group;

        this.#groupKey = group ? group.key : null;

        this.notifyPropertyChanged("group", group, oldGroup);
    }

    get column(): number {
        return this.#column;
    }

    get columnSpan(): number {
        return this.#columnSpan;
    }

    get offset() {
        return this.#offset;
    }

    get tabKey(): string {
        return this.#tabKey;
    }

    get tab(): PersistentObjectAttributeTab {
        return this.#tab;
    }
    set tab(tab: PersistentObjectAttributeTab) {
        const oldTab = this.#tab;
        this.#tab = tab;

        this.#tabKey = tab ? tab.key : null;

        this.notifyPropertyChanged("tab", tab, oldTab);
    }

    get isSystem(): boolean {
        return this.#isSystem;
    }

    get visibility(): Dto.PersistentObjectAttributeVisibility {
        return this.#visibility;
    }

    set visibility(visibility: Dto.PersistentObjectAttributeVisibility) {
        if (this.#visibility === visibility)
            return;

        const oldIsVisible = this.#isVisible;
        const newIsVisible = visibility.indexOf("Always") >= 0 || visibility.indexOf(this.parent.isNew ? "New" : "Read") >= 0;
        if (newIsVisible !== oldIsVisible)
            this.#isVisible = newIsVisible;

        const oldVisibility = this.#visibility;
        this.notifyPropertyChanged("visibility", this.#visibility = visibility, oldVisibility);

        if (newIsVisible !== oldIsVisible) {
            this.notifyPropertyChanged("isVisible", this.#isVisible, oldIsVisible);

            if (typeof(oldVisibility) !== "undefined" && !this.parent.isBusy)
                this.parent[PersistentObjectSymbols.RefreshTabsAndGroups](this);
        }
    }

    get isVisible(): boolean {
        return this.#isVisible;
    }

    get validationError(): string {
        return this.#validationError;
    }

    set validationError(error: string) {
        const oldValidationError = this.#validationError;
        if (oldValidationError !== error)
            this.notifyPropertyChanged("validationError", this.#validationError = error, oldValidationError);
    }

    get rules(): string {
        return this.#rules;
    }

    private _setRules(rules: string) {
        const oldRules = this.#rules;
        if (oldRules !== rules)
            this.notifyPropertyChanged("rules", this.#rules = rules, oldRules);
    }

    get isRequired(): boolean {
        return this.#isRequired;
    }

    private _setIsRequired(isRequired: boolean) {
        const oldIsRequired = this.#isRequired;
        if (oldIsRequired !== isRequired)
            this.notifyPropertyChanged("isRequired", this.#isRequired = isRequired, oldIsRequired);
    }

    get isReadOnly(): boolean {
        return this.#isReadOnly;
    }

    private _setIsReadOnly(isReadOnly: boolean) {
        const oldisReadOnly = this.#isReadOnly;
        if (oldisReadOnly !== isReadOnly)
            this.notifyPropertyChanged("isReadOnly", this.#isReadOnly = isReadOnly, oldisReadOnly);
    }

    get displayValue(): string {
        if (this.#displayValueSource === this.#serviceValue)
            return !String.isNullOrEmpty(this.#displayValue) ? this.#displayValue : "—";
        else
            this.#displayValueSource = this.#serviceValue;

        let format = this.getTypeHint("DisplayFormat", "{0}");

        let value = this.value;
        if (value != null && (this.type === "Boolean" || this.type === "NullableBoolean" || this.type === "YesNo"))
            value = this.service.getTranslatedMessage(value ? this.getTypeHint("TrueKey", "Yes") : this.getTypeHint("FalseKey", "No"));
        else if (this.type === "KeyValueList") {
            if (this.options && this.options.length > 0) {
                const isEmpty = String.isNullOrEmpty(value);
                let option = (<PersistentObjectAttributeOption[]>this.options).find(o => o.key === value || (isEmpty && String.isNullOrEmpty(o.key)));
                if (this.isRequired && option == null)
                    option = (<PersistentObjectAttributeOption[]>this.options).find(o => String.isNullOrEmpty(o.key));

                if (option != null)
                    value = option.value;
                else if (this.isRequired)
                    value = this.options.length > 0 ? (<PersistentObjectAttributeOption>this.options[0]).value : null;
            }
        }
        else if (value != null && (this.type === "Time" || this.type === "NullableTime")) {
            value = value.trimEnd("0").trimEnd(".");
            if (value.startsWith("0:"))
                value = value.substr(2);
            if (value.endsWith(":00"))
                value = value.substr(0, value.length - 3);
        } else if (value != null && (this.type === "User" || this.type === "NullableUser") && this.options.length > 0)
            value = this.options[0];
        else {
            const calculated = this.service.hooks.onGetAttributeDisplayValue(this, value);
            if (typeof calculated !== "undefined")
                return (this.#displayValue = calculated);
        }

        if (format === "{0}") {
            if (this.type === "Date" || this.type === "NullableDate")
                format = "{0:" + CultureInfo.currentCulture.dateFormat.shortDatePattern + "}";
            else if (this.type === "DateTime" || this.type === "NullableDateTime")
                format = "{0:" + CultureInfo.currentCulture.dateFormat.shortDatePattern + " " + CultureInfo.currentCulture.dateFormat.shortTimePattern + "}";
        }

        return !String.isNullOrEmpty(this.#displayValue = value != null ? String.format(format, value) : null) ? this.#displayValue : "—";
    }

    get shouldRefresh(): boolean {
        return this._shouldRefresh;
    }

    get value(): any {
        if (this.#lastParsedValue !== this.#serviceValue) {
            this.#lastParsedValue = this.#serviceValue;

            if (!this.parent.isBulkEdit || !!this.#serviceValue)
                this.#cachedValue = DataType.fromServiceString(this.#serviceValue, this.type);
            else
                this.#cachedValue = null;
        }

        return this.#cachedValue;
    }

    set value(val: any) {
        this.setValue(val).catch(() => {});
    }

    async setValue(val: any, allowRefresh: boolean = true): Promise<any> {
        if (!this.parent.isEditing || this.parent.isFrozen || this.isReadOnly)
            return this.value;

        this.validationError = null;

        if (val && typeof val === "string") {
            const charactercasing = this.getTypeHint("charactercasing", "", undefined, true);
            if (charactercasing) {
                if (charactercasing.toUpperCase() === "LOWER")
                    val = (<string>val).toLowerCase();
                else if (charactercasing.toUpperCase() === "UPPER")
                    val = (<string>val).toUpperCase();
            }
        }

        const newServiceValue = DataType.toServiceString(val, this.type);

        // If value is equal
        if (this.#cachedValue === val || (this.#serviceValue == null && String.isNullOrEmpty(newServiceValue)) || this.#serviceValue === newServiceValue) {
            if (allowRefresh && this._shouldRefresh)
                await this.triggerRefresh();
        }
        else {
            const oldDisplayValue = this.displayValue;
            const oldServiceValue = this.#serviceValue;
            this.notifyPropertyChanged("value", this.#serviceValue = newServiceValue, oldServiceValue);
            this.isValueChanged = true;

            const newDisplayValue = this.displayValue;
            if (oldDisplayValue !== newDisplayValue)
                this.notifyPropertyChanged("displayValue", newDisplayValue, oldDisplayValue);

            if (this.triggersRefresh) {
                if (allowRefresh)
                    await this.triggerRefresh();
                else
                    this._shouldRefresh = true;
            }

            this.parent.triggerDirty();
        }

        return this.value;
    }

    get isValueChanged(): boolean {
        return this.#isValueChanged;
    }

    set isValueChanged(isValueChanged: boolean) {
        if (isValueChanged === this.#isValueChanged)
            return;

        const oldIsValueChanged = this.#isValueChanged;
        this.notifyPropertyChanged("isValueChanged", this.#isValueChanged = isValueChanged, oldIsValueChanged);
    }

    get isSensitive(): boolean {
        return this.#isSensitive;
    }

    get input(): HTMLInputElement {
        return this.#input;
    }

    get actions(): Array<Action> & Record<string, Action> {
        return this.#actions;
    }

    private _setActions(actions: Array<Action> & Record<string, Action>) {
        const oldActions = this.#actions;
        this.notifyPropertyChanged("actions", this.#actions = actions, oldActions);
    }

    get tag(): any {
        return this.#tag;
    }

    getTypeHint(name: string, defaultValue?: string, typeHints?: any, ignoreCasing?: boolean): string {
        if (typeHints != null) {
            if (this.typeHints != null)
                typeHints = Object.assign({...this.typeHints}, typeHints);
        }
        else
            typeHints = this.typeHints;

        if (typeHints != null) {
            const typeHint = typeHints[ignoreCasing ? name : name.toLowerCase()];

            if (typeHint != null)
                return typeHint;
        }

        return defaultValue;
    }

    triggerRefresh(immediate?: boolean): Promise<any> {
        this._shouldRefresh = false;
        return this.parent.triggerAttributeRefresh(this, immediate);
    }

    protected _toServiceObject(inheritedPropertyValues?: Record<string, any>) {
        const initialPropertyValues = {
            id: this.id,
            name: this.name,
            label: this.label,
            type: this.type,
            isReadOnly: this.isReadOnly,
            triggersRefresh: this.triggersRefresh,
            isRequired: this.isRequired,
            differsInBulkEditMode: this.parent.isBulkEdit && this.isValueChanged,
            isValueChanged: this.isValueChanged,
            visibility: this.visibility
        };

        const result = this._copyPropertiesFromValues(!inheritedPropertyValues ? initialPropertyValues : { ...initialPropertyValues, ...inheritedPropertyValues});

        result.value = this.#serviceValue;
        result.actions = this.actions.map(a => a.name);

        if (this.options && this.options.length > 0 && this.isValueChanged)
            result.options = (<any[]>this.options).map(o => o ? (typeof (o) !== "string" ? o.key + "=" + o.value : o) : null);
        else
            result.options = this.#serviceOptions;

        return result;
    }

    protected _refreshFromResult(resultAttr: Dto.PersistentObjectAttribute, resultWins: boolean): boolean {
        let visibilityChanged = false;

        this.label = resultAttr.label;

        const newActions = <any>[];
        Action.addActions(this.service, this.parent, newActions, resultAttr.actions || []);
        this._setActions(newActions);

        if (this.type !== "Reference")
            this._setOptions(resultAttr.options);

        this._setIsReadOnly(resultAttr.isReadOnly);
        this._setRules(resultAttr.rules);
        this._setIsRequired(resultAttr.isRequired);

        if (this.visibility !== resultAttr.visibility) {
            this.visibility = resultAttr.visibility;
            visibilityChanged = true;
        }

        const resultAttrValue = resultAttr.value !== undefined ? resultAttr.value : null;
        if (resultWins || (this.#serviceValue !== resultAttrValue && (this.isReadOnly || this.#refreshServiceValue !== resultAttrValue))) {
            const oldDisplayValue = this.displayValue;
            const oldValue = this.value;

            this.#serviceValue = resultAttrValue;
            this.#lastParsedValue = undefined;

            this.notifyPropertyChanged("value", this.value, oldValue);
            this.notifyPropertyChanged("displayValue", this.displayValue, oldDisplayValue);

            if (this.#input)
                this.#input.value = null;

            this.isValueChanged = resultAttr.isValueChanged;
        }

        this.#tag = resultAttr.tag;
        this.#refreshServiceValue = undefined;

        this.triggersRefresh = resultAttr.triggersRefresh;
        this.validationError = resultAttr.validationError || null;

        if (resultAttr.typeHints && Object.keys(resultAttr.typeHints).some(k => resultAttr.typeHints[k] !== this.typeHints[k])) {
            for (let name in this.typeHints) {
                if (resultAttr.typeHints[name] != null)
                    continue;

                resultAttr.typeHints[name] = this.typeHints[name];
            }

            const oldTypeHints = this.typeHints;
            this.notifyPropertyChanged("typeHints", this.typeHints = resultAttr.typeHints, oldTypeHints);
        }

        return visibilityChanged;
    }

    protected _setOptions(options: string[]) {
        const oldOptions = this.options ? this.options.slice() : undefined;

        if (!options || options.length === 0) {
            this.options = this.#serviceOptions = options;
            if (oldOptions && oldOptions.length > 0)
                this.notifyPropertyChanged("options", this.options, oldOptions);

            return;
        }

        this.#serviceOptions = <any[]>options.slice(0);
        const keyValuePairOptionType = ["FlagsEnum", "KeyValueList"].indexOf(this.type) !== -1 || (this.type === "Reference" && (<PersistentObjectAttributeWithReference><any>this).selectInPlace);

        if (!keyValuePairOptionType)
            this.options = options;
        else {
            this.options = options.map(o => {
                const optionSplit = o.splitWithTail("=", 2);
                return {
                    key: optionSplit[0],
                    value: optionSplit[1]
                };
            });
        }

        this.notifyPropertyChanged("options", this.options, oldOptions);
    }

    #backupServiceValue() {
        this.#refreshServiceValue = this.#serviceValue;
    }
}