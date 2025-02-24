import type * as Dto from "./typings/service.js"
import { ServiceObjectWithActions } from "./service-object-with-actions.js"
import { PersistentObjectAttribute } from "./persistent-object-attribute.js"
import { PersistentObjectTab, PersistentObjectAttributeTab, PersistentObjectQueryTab } from "./persistent-object-tab.js"
import type { Query } from "./query.js"
import type { Service } from "./service.js"
import { PersistentObjectAttributeWithReference } from "./persistent-object-attribute-with-reference.js"
import type { PersistentObjectAttributeGroup } from "./persistent-object-attribute-group.js"
import { PersistentObjectSymbols, PersistentObjectAttributeSymbols } from "./advanced.js"

/**
 * Defines available layout modes when displaying persistent objects.
 */
export enum PersistentObjectLayoutMode {
    FullPage,
    MasterDetail
}

/**
 * Handles the state and operations for persistent objects, including editing,
 * saving, refreshing data, and managing attributes and tabs.
 */
export class PersistentObject extends ServiceObjectWithActions {
    readonly #isSystem;
    #lastResult;
    #lastUpdated;
    #lastResultBackup;
    #securityToken;
    #isEditing = false;
    #isDirty = false;
    readonly #id;
    readonly #type;
    #breadcrumb;
    #isDeleted;
    #tabs;
    #isFrozen = false;
    #tag;
    readonly isBreadcrumbSensitive;
    readonly forceFromAction;
    readonly fullTypeName;
    readonly label;
    objectId;
    readonly isHidden;
    isNew;
    readonly isReadOnly;
    readonly queryLayoutMode;
    readonly newOptions;
    readonly ignoreCheckRules;
    stateBehavior;
    readonly dialogSaveAction;
    parent;
    ownerDetailAttribute;
    ownerAttributeWithReference;
    ownerPersistentObject;
    ownerQuery;
    readonly bulkObjectIds;
    readonly queriesToRefresh = [];
    readonly attributes: PersistentObjectAttribute[] & Record<string, PersistentObjectAttribute>;
    readonly queries: Query[] & Record<string, Query>;

    /**
     * Instantiates a persistent object using a service instance and initial data.
     * @param service The service context providing hooks and actions.
     * @param po The data representing the persistent object.
     */
    constructor(service: Service, po: Dto.PersistentObject) {
        super(service, po.actions, po.actionLabels);

        this[PersistentObjectSymbols.Dto] = po;
        this[PersistentObjectSymbols.PrepareAttributesForRefresh] = this.#prepareAttributesForRefresh.bind(this);

        this.#id = po.id;
        this.#isSystem = !!po.isSystem;
        this.#type = po.type;
        this.label = po.label;
        this.forceFromAction = po.forceFromAction;
        this.fullTypeName = po.fullTypeName;
        this.queryLayoutMode = po.queryLayoutMode === "FullPage" ? PersistentObjectLayoutMode.FullPage : PersistentObjectLayoutMode.MasterDetail;
        this.objectId = po.objectId;
        this.#breadcrumb = po.breadcrumb;
        this.isBreadcrumbSensitive = po.isBreadcrumbSensitive;
        this.setNotification(po.notification, po.notificationType, po.notificationDuration, true);
        this.isNew = !!po.isNew;
        this.newOptions = po.newOptions;
        this.isReadOnly = !!po.isReadOnly;
        this.isHidden = !!po.isHidden;
        this.#isDeleted = !!po.isDeleted;
        this.ignoreCheckRules = !!po.ignoreCheckRules;
        this.stateBehavior = po.stateBehavior || "None";
        this.#setIsEditing(false);
        this.#securityToken = po.securityToken;
        this.bulkObjectIds = po.bulkObjectIds;
        this.queriesToRefresh = po.queriesToRefresh || [];
        this.parent = po.parent != null ? service.hooks.onConstructPersistentObject(service, po.parent) : null;

        // Initialize attributes
        const attributes = po.attributes?.map(attr => this.#createPersistentObjectAttribute(attr)) || [];
        attributes.forEach(attr => attributes[attr.name] = attr);

        this.attributes = attributes as PersistentObjectAttribute[] & Record<string, PersistentObjectAttribute>;

        // Initialize queries
        const queries = po.queries?.map(query => service.hooks.onConstructQuery(service, query, this)).orderBy(q => q.offset) || []; 
        queries.forEach(query => queries[query.name] = query);

        this.queries = queries as Query[] & Record<string, Query>;

        // Initialize tabs
        const attributeTabs = po.tabs
            ? this.attributes
                  .orderBy(attr => attr.offset)
                  .groupBy(attr => attr.tabKey)
                  .map(attributesByTab => {
                      const groups = attributesByTab.value
                          .orderBy(attr => attr.offset)
                          .groupBy(attr => attr.groupKey)
                          .map(attributesByGroup => {
                              const newGroup = this.service.hooks.onConstructPersistentObjectAttributeGroup(
                                  service,
                                  attributesByGroup.key,
                                  attributesByGroup.value,
                                  this
                              );
                              attributesByGroup.value.forEach(attr => (attr.group = newGroup));

                              return newGroup;
                          });
                      groups.forEach((g, n) => (g.index = n));

                      const serviceTab = po.tabs[attributesByTab.key] || {};
                      const newTab = this.service.hooks.onConstructPersistentObjectAttributeTab(
                          service,
                          groups,
                          attributesByTab.key,
                          serviceTab.id,
                          serviceTab.name,
                          serviceTab.layout,
                          this,
                          serviceTab.columnCount,
                          !this.isHidden
                      );
                      attributesByTab.value.forEach(attr => (attr.tab = newTab));

                      return newTab;
                  })
            : [];

        this.#tabs = this.service.hooks.onSortPersistentObjectTabs(
            this,
            <PersistentObjectAttributeTab[]>attributeTabs,
            this.queries.map(q => this.service.hooks.onConstructPersistentObjectQueryTab(this.service, q))
        );

        if (this.#tabs.length === 0)
            this.#tabs = [
                this.service.hooks.onConstructPersistentObjectAttributeTab(service, [], "", "", "", null, this, 0, true)
            ];

        this.#tag = po.tag;
        this.#lastResult = po;

        if (
            this.isNew ||
            this.stateBehavior === "OpenInEdit" ||
            this.stateBehavior.indexOf("OpenInEdit") >= 0 ||
            this.stateBehavior === "StayInEdit" ||
            this.stateBehavior.indexOf("StayInEdit") >= 0
        )
            this.beginEdit();

        this._initializeActions();
        this.dialogSaveAction = po.dialogSaveAction
            ? this.getAction(po.dialogSaveAction)
            : this.getAction("EndEdit") || this.getAction("Save");

        this.service.hooks.onRefreshFromResult(this);
        this.#setLastUpdated(new Date());
    }

    /**
     * Creates an attribute instance based on its properties, choosing between
     * standard, reference, or detail attribute types.
     * @param attr The attribute DTO.
     */
    #createPersistentObjectAttribute(attr: Dto.PersistentObjectAttribute): PersistentObjectAttribute {
        if ((<Dto.PersistentObjectAttributeWithReference>attr).displayAttribute || (<Dto.PersistentObjectAttributeWithReference>attr).objectId)
            return this.service.hooks.onConstructPersistentObjectAttributeWithReference(this.service, attr, this);

        if ((<Dto.PersistentObjectAttributeAsDetail>attr).objects || (<Dto.PersistentObjectAttributeAsDetail>attr).details)
            return this.service.hooks.onConstructPersistentObjectAttributeAsDetail(this.service, attr, this);

        return this.service.hooks.onConstructPersistentObjectAttribute(this.service, attr, this);
    }

    /**
     * Unique identifier of the persistent object.
     */
    get id(): string {
        return this.#id;
    }

    /**
     * Indicates if the object is defined by the system.
     */
    get isSystem(): boolean {
        return this.#isSystem;
    }

    /**
     * Provides type information for the persistent object.
     */
    get type(): string {
        return this.#type;
    }

    /**
     * Determines if the object represents a bulk edit scenario.
     */
    get isBulkEdit(): boolean {
        return this.bulkObjectIds && this.bulkObjectIds.length > 0;
    }

    /**
     * Lists the tabs associated with the persistent object.
     */
    get tabs(): PersistentObjectTab[] {
        return this.#tabs;
    }

    set tabs(tabs: PersistentObjectTab[]) {
        const oldTabs = this.#tabs;
        this.notifyPropertyChanged("tabs", (this.#tabs = tabs), oldTabs);
    }

    /**
     * Retrieves additional tag data attached to the object.
     */
    get tag() {
        return this.#tag;
    }

    /**
     * Flag indicating if the object is currently in edit mode.
     */
    get isEditing(): boolean {
        return this.#isEditing;
    }

    /**
     * Sets edit mode and notifies related actions.
     * @param value Whether editing mode is enabled.
     */
    #setIsEditing(value: boolean) {
        this.#isEditing = value;
        this.actions.forEach(action => action._onParentIsEditingChanged(value));
        this.notifyPropertyChanged("isEditing", value, !value);
    }

    /**
     * Navigation breadcrumb representing the object's location.
     */
    get breadcrumb(): string {
        return this.#breadcrumb;
    }

    /**
     * Updates the breadcrumb value and notifies listeners when it changes.
     * @param breadcrumb The new breadcrumb.
     */
    #setBreadcrumb(breadcrumb: string) {
        const oldBreadcrumb = this.#breadcrumb;
        if (oldBreadcrumb !== breadcrumb)
            this.notifyPropertyChanged("breadcrumb", (this.#breadcrumb = breadcrumb), oldBreadcrumb);
    }

    /**
     * Indicates if there are unsaved modifications.
     */
    get isDirty(): boolean {
        return this.#isDirty;
    }

    /**
     * Marks the object as having unsaved changes and alerts dependent actions.
     * @param value The new dirty state.
     * @param force Allows flagging as dirty even if not in edit mode.
     */
    #setIsDirty(value: boolean, force?: boolean) {
        if (value && (!this.isEditing && !force))
            throw "Cannot flag persistent object as dirty when not in edit mode.";

        const oldIsDirty = this.#isDirty;
        if (oldIsDirty !== value) {
            this.notifyPropertyChanged("isDirty", (this.#isDirty = value), oldIsDirty);
            this.actions.forEach(action => action._onParentIsDirtyChanged(value));

            if (this.ownerDetailAttribute && value)
                this.ownerDetailAttribute.onChanged(false);
        }
    }

    /**
     * Indicates whether the object is marked as deleted.
     */
    get isDeleted(): boolean {
        return this.#isDeleted;
    }

    set isDeleted(isDeleted: boolean) {
        const oldIsDeleted = this.#isDeleted;
        if (oldIsDeleted !== isDeleted)
            this.notifyPropertyChanged("isDeleted", (this.#isDeleted = isDeleted), oldIsDeleted);
    }

    /**
     * Shows if the object is in a frozen state.
     */
    get isFrozen(): boolean {
        return this.#isFrozen;
    }

    /**
     * Freezes the object to prevent modifications.
     */
    freeze() {
        if (this.#isFrozen)
            return;

        this.notifyPropertyChanged("isFrozen", (this.#isFrozen = true), false);
    }

    /**
     * Unfreezes the object to allow modifications.
     */
    unfreeze() {
        if (!this.#isFrozen)
            return;

        this.notifyPropertyChanged("isFrozen", (this.#isFrozen = false), true);
    }

    /**
     * Retrieves an attribute by name.
     * @param name The attribute's name.
     */
    getAttribute(name: string): PersistentObjectAttribute {
        return this.attributes[name];
    }

    /**
     * Gets the current value of a specified attribute.
     * @param name The attribute's name.
     */
    getAttributeValue<T = any>(name: string): T {
        const attr = this.attributes[name];
        return attr != null ? attr.value : null;
    }

    /**
     * Sets a new value for an attribute and optionally triggers a refresh.
     * @param name The attribute's name.
     * @param value The new value.
     * @param allowRefresh If true, a refresh may follow the update.
     */
    setAttributeValue(name: string, value: any, allowRefresh?: boolean): Promise<any> {
        const attr = <PersistentObjectAttribute>this.attributes[name];
        if (!attr)
            return Promise.reject("Attribute does not exist.");

        return attr.setValue(value, allowRefresh);
    }

    /**
     * Timestamp marking the last update.
     */
    get lastUpdated(): Date {
        return this.#lastUpdated;
    }

    /**
     * Sets the last update time and alerts listeners.
     * @param lastUpdated The new timestamp.
     */
    #setLastUpdated(lastUpdated: Date) {
        const oldLastUpdated = this.#lastUpdated;
        this.notifyPropertyChanged("lastUpdated", (this.#lastUpdated = lastUpdated), oldLastUpdated);
    }

    /**
     * Retrieves a query by name linked to this object.
     * @param name The query's name.
     */
    getQuery(name: string): Query {
        return this.queries[name];
    }

    /**
     * Enters edit mode and saves the current state for potential rollback.
     */
    beginEdit() {
        if (!this.isEditing) {
            this.#lastResultBackup = this.#lastResult;
            this.#setIsEditing(true);
        }
    }

    /**
     * Cancels edit mode, reverts changes from backup, and resets notifications.
     */
    cancelEdit() {
        if (this.isEditing) {
            this.#setIsEditing(false);
            this.#setIsDirty(false);

            const backup = this.#lastResultBackup;
            this.#lastResultBackup = null;
            this.refreshFromResult(backup, true);

            if (!!this.notification)
                this.setNotification();

            if (this.stateBehavior === "StayInEdit" || this.stateBehavior.indexOf("StayInEdit") >= 0)
                this.beginEdit();
        }
    }

    /**
     * Saves changes, refreshes state, and handles post-save notifications.
     * @param waitForOwnerQuery Optionally waits for the owner query to refresh.
     */
    save(waitForOwnerQuery?: boolean): Promise<boolean> {
        return this.queueWork(async () => {
            if (this.isEditing) {
                const attributesToRefresh = this.attributes.filter(attr => attr.shouldRefresh);
                for (let i = 0; i < attributesToRefresh.length; i++)
                    await attributesToRefresh[i].triggerRefresh(true);

                const po = await this.service.executeAction("PersistentObject.Save", this, null, null, null);
                if (!po)
                    return false;

                const wasNew = this.isNew;
                this.refreshFromResult(po, true);

                if (!this.notification || this.notification.trim().length === 0 || this.notificationType !== "Error") {
                    this.#setIsDirty(false);

                    if (!wasNew) {
                        this.#setIsEditing(false);
                        if (this.stateBehavior === "StayInEdit" || this.stateBehavior.indexOf("StayInEdit") >= 0)
                            this.beginEdit();
                    }

                    if (this.ownerAttributeWithReference) {
                        if (this.ownerAttributeWithReference.objectId !== this.objectId) {
                            let parent = this.ownerAttributeWithReference.parent;
                            if (parent.ownerDetailAttribute != null)
                                parent = parent.ownerDetailAttribute.parent;

                            parent.beginEdit();
                            this.ownerAttributeWithReference.changeReference([po.objectId]);
                        } else if (this.ownerAttributeWithReference.value !== this.breadcrumb)
                            this.ownerAttributeWithReference.value = this.breadcrumb;
                    } else if (this.ownerQuery)
                        this.ownerQuery.search({ keepSelection: this.isBulkEdit });
                } else if (!!this.notification && this.notification.trim().length > 0)
                    throw this.notification;
            }

            return true;
        });
    }

    /**
     * Serializes the object into a service-friendly format.
     * @param skipParent If true, parent data is excluded.
     */
    toServiceObject(skipParent: boolean = false): any {
        const result = this._copyPropertiesFromValues({
            "id": this.#id,
            "type": this.#type,
            "objectId": this.objectId,
            "isNew": this.isNew,
            "isHidden": this.isHidden,
            "bulkObjectIds": this.bulkObjectIds,
            "securityToken": this.#getSecurityToken(),
            "isSystem": this.#isSystem
        });

        if (this.ownerQuery)
            result.ownerQueryId = this.ownerQuery.id;

        if (this.parent && !skipParent)
            result.parent = this.parent.toServiceObject();
        if (this.attributes)
            result.attributes = this.attributes.map(attr => attr[PersistentObjectAttributeSymbols.ToServiceObject]());
        if (this.#lastResult.metadata != null)
            result.metadata = this.#lastResult.metadata;

        return result;
    }

    /**
     * Refreshes the object state from a new service result, merging changes.
     * @param result The new data from the service.
     * @param resultWins If true, the new data overrides current values.
     */
    refreshFromResult(po: PersistentObject | Dto.PersistentObject, resultWins: boolean = false) {
        const result = po instanceof PersistentObject ? po[PersistentObjectSymbols.Dto] : po;

        const changedAttributes: PersistentObjectAttribute[] = [];
        let isDirty = false;

        if (!this.isEditing && result.attributes.some(a => a.isValueChanged))
            this.beginEdit();

        this.#lastResult = result;

        this.attributes.removeAll(attr => {
            if (!result.attributes.some(serviceAttr => serviceAttr.id === attr.id)) {
                delete this.attributes[attr.name];
                attr.parent = null;
                changedAttributes.push(attr);

                return true;
            }

            return false;
        });

        this.attributes.forEach(attr => {
            let serviceAttr = result.attributes.find(serviceAttr => serviceAttr.id === attr.id);
            if (serviceAttr) {
                if (!(serviceAttr instanceof PersistentObjectAttribute))
                    serviceAttr = this.#createPersistentObjectAttribute(serviceAttr);

                if (attr[PersistentObjectAttributeSymbols.RefreshFromResult](serviceAttr, resultWins))
                    changedAttributes.push(attr);
            }

            if (attr.isValueChanged)
                isDirty = true;
        });

        result.attributes.forEach(serviceAttr => {
            if (!this.attributes.some(a => a.id === serviceAttr.id)) {
                const attr = this.#createPersistentObjectAttribute(serviceAttr);
                this.attributes.push(attr);
                attr.parent = this;

                changedAttributes.push(attr);

                if (attr.isValueChanged)
                    isDirty = true;
            }
        });

        if (changedAttributes.length > 0)
            this.refreshTabsAndGroups(...changedAttributes);

        this.setNotification(result.notification, result.notificationType, result.notificationDuration);
        this.#setIsDirty(isDirty, true);

        this.objectId = result.objectId;
        if (this.isNew)
            this.isNew = result.isNew;

        this.#securityToken = result instanceof PersistentObject ? result.#getSecurityToken() : (result as Dto.PersistentObject).securityToken;
        if (result.breadcrumb)
            this.#setBreadcrumb(result.breadcrumb);

        if (result.queriesToRefresh) {
            result.queriesToRefresh.forEach(async id => {
                const query = this.queries.find(q => q.id === id || q.name === id);
                if (query && (query.hasSearched || query.notification || query.totalItems != null))
                    await query.search();
            });
        }

        this.#tag = result.tag;

        this.service.hooks.onRefreshFromResult(this);
        this.#setLastUpdated(new Date());
    }

    #getSecurityToken(): string {
        return this.#securityToken;
    }

    /**
     * Rebuilds the tabs and groups based on changed attributes.
     * @param changedAttributes The attributes that have been modified.
     */
    refreshTabsAndGroups(...changedAttributes: PersistentObjectAttribute[]) {
        const tabGroupsChanged = new Set<PersistentObjectAttributeTab>();
        const tabGroupAttributesChanged = new Set<PersistentObjectAttributeGroup>();
        let tabsRemoved = false;
        let tabsAdded = false;
        changedAttributes.forEach(attr => {
            let tab = <PersistentObjectAttributeTab>this.tabs.find(
                t => t instanceof PersistentObjectAttributeTab && t.key === attr.tabKey
            );
            if (!tab) {
                if (!attr.isVisible) return;

                const groups = [
                    this.service.hooks.onConstructPersistentObjectAttributeGroup(this.service, attr.groupKey, [attr], this)
                ];
                groups[0].index = 0;

                const serviceTab = this.#lastResult.tabs[attr.tabKey];
                attr.tab = tab = this.service.hooks.onConstructPersistentObjectAttributeTab(
                    this.service,
                    groups,
                    attr.tabKey,
                    serviceTab.id,
                    serviceTab.name,
                    serviceTab.layout,
                    this,
                    serviceTab.columnCount,
                    !this.isHidden
                );
                this.tabs.push(tab);
                tabsAdded = true;
                return;
            }

            let group = tab.groups.find(g => g.key === attr.groupKey);
            if (!group && attr.isVisible) {
                group = this.service.hooks.onConstructPersistentObjectAttributeGroup(this.service, attr.groupKey, [attr], this);
                tab.groups.push(group);
                tab.groups.sort((g1, g2) => g1.attributes.min(a => a.offset) - g2.attributes.min(a => a.offset));
                tab.groups.forEach((g, n) => (g.index = n));

                tabGroupsChanged.add(tab);
            } else if (attr.isVisible && attr.parent) {
                if (group.attributes.indexOf(attr) < 0) {
                    group.attributes.push(attr);
                    tabGroupAttributesChanged.add(group);

                    tab.attributes.push(attr);

                    tab.attributes[attr.name] = group.attributes[attr.name] = attr;
                    group.attributes.sort((x, y) => x.offset - y.offset);
                }
            } else if (group) {
                group.attributes.remove(attr);
                delete group.attributes[attr.name];

                tab.attributes.remove(attr);
                delete tab.attributes[attr.name];

                if (group.attributes.length === 0) {
                    tab.groups.remove(group);
                    tabGroupsChanged.add(tab);

                    if (tab.groups.length === 0) {
                        this.tabs.remove(tab);
                        tabsRemoved = true;
                        return;
                    } else tab.groups.forEach((g, n) => (g.index = n));
                } else tabGroupAttributesChanged.add(group);
            }
        });

        const attributeTabs = <PersistentObjectAttributeTab[]>this.tabs.filter(
            t => t instanceof PersistentObjectAttributeTab
        );

        if (tabsAdded) {
            attributeTabs.sort(
                (t1, t2) =>
                    [].concat(...t1.groups.map(g => g.attributes)).min(a => a.offset) -
                    [].concat(...t2.groups.map(g => g.attributes)).min(a => a.offset)
            );

            const queryTabs = <PersistentObjectQueryTab[]>this.tabs.filter(t => t instanceof PersistentObjectQueryTab);
            queryTabs.sort((q1, q2) => q1.query.offset - q2.query.offset);

            this.tabs = this.service.hooks.onSortPersistentObjectTabs(this, attributeTabs, queryTabs);
        } else if (tabsRemoved) this.tabs = this.tabs.slice();

        if (tabGroupsChanged.size > 0)
            tabGroupsChanged.forEach(tab => (tab.groups = tab.groups.slice()));

        if (tabGroupAttributesChanged.size > 0) {
            tabGroupAttributesChanged.forEach(group => {
                group.attributes = group.attributes.slice();
            });
        }

        // Flag tabs as visible if they have any visible attributes
        attributeTabs.forEach(tab => (tab.isVisible = tab.attributes.some(a => a.isVisible)));
    }

    /**
     * Flags the object as dirty when in edit mode.
     */
    triggerDirty(): boolean {
        if (this.isEditing) this.#setIsDirty(true);
        return this.isDirty;
    }

    /**
     * Refreshes a given attribute by re-querying the service.
     * @param attr The attribute to refresh.
     * @param immediate If true, performs the refresh immediately.
     */
    triggerAttributeRefresh(attr: PersistentObjectAttribute, immediate?: boolean): Promise<boolean> {
        const attrValue = attr.value;
        const work = async () => {
            if (attrValue !== attr.value)
                return false;

            this.#prepareAttributesForRefresh(attr);
            const result = await this.service.executeAction(
                "PersistentObject.Refresh",
                this,
                null,
                null,
                { RefreshedPersistentObjectAttributeId: attr.id }
            );
            if (this.isEditing) this.refreshFromResult(result);

            return true;
        };

        let result: Promise<boolean>;
        if (!immediate) result = this.queueWork(work, false);
        else result = work();

        if (
            result &&
            Boolean.parse(attr.getTypeHint("TriggerRefreshOnOwner", "false")?.toLowerCase()) &&
            this.ownerDetailAttribute?.triggersRefresh
        ) {
            return result.then(async res => {
                await this.ownerDetailAttribute._triggerAttributeRefresh(immediate);
                return res;
            });
        }

        return result;
    }

    /**
     * Prepares all attributes for a refresh by caching current service values.
     * @param sender The attribute initiating the refresh.
     */
    #prepareAttributesForRefresh(sender: PersistentObjectAttribute) {
        this.attributes
            .filter(a => a.id !== sender.id)
            .forEach(attr => {
                (<any>attr)._refreshServiceValue = (<any>attr)._serviceValue;
                if (attr instanceof PersistentObjectAttributeWithReference) {
                    const attrWithRef = <any>attr;
                    attrWithRef._refreshObjectId = attrWithRef.objectId;
                }
            });
    }
}