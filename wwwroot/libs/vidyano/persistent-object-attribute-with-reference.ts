import { PersistentObjectSymbols } from "./advanced.js"
import { PersistentObjectAttribute } from "./persistent-object-attribute.js"
import type { PersistentObject } from "./persistent-object.js"
import type { Query } from "./query.js"
import type { QueryResultItem } from "./query-result-item.js"
import type { Service } from "./service.js"
import type * as Dto from "./typings/service.js"

export class PersistentObjectAttributeWithReference extends PersistentObjectAttribute {
    #canAddNewReference: boolean;
    #displayAttribute: string;
    #lookup: Query;
    #objectId: string;
    #selectInPlace: boolean;

    constructor(service: Service, attr: Dto.PersistentObjectAttributeWithReference, parent: PersistentObject) {
        super(service, attr, parent);

        if (attr.lookup) {
            this.#lookup = this.service.hooks.onConstructQuery(service, attr.lookup, parent, false, 1);
            this.#lookup.ownerAttributeWithReference = this;
        }
        else
            this.#lookup = null;

        this.#objectId = typeof attr.objectId === "undefined" ? null : attr.objectId;
        this.#displayAttribute = attr.displayAttribute;
        this.#canAddNewReference = !!attr.canAddNewReference;
        this.#selectInPlace = !!attr.selectInPlace;
        this.options = attr.options;
    }

    /**
     * Gets a value indicating whether a new reference can be added.
     */
    get canAddNewReference(): boolean {
        return this.#canAddNewReference;
    }

    /**
     * Gets the display attribute of the reference.
     */
    get displayAttribute(): string {
        return this.#displayAttribute;
    }

    /**
     * Gets the lookup query for this attribute.
     */
    get lookup(): Query {
        return this.#lookup;
    }

    /**
     * Gets the object id of the reference.
     */
    get objectId(): string {
        return this.#objectId;
    }

    /**
     * Gets a value indicating whether the reference should be selected in place.
     */
    get selectInPlace(): boolean {
        return this.#selectInPlace;
    }

    async addNewReference() {
        if (this.isReadOnly)
            return;

        try {
            const po = await this.service.executeAction("Query.New", this.parent, this.lookup, null, { PersistentObjectAttributeId: this.id });
            po.ownerAttributeWithReference = this;
            po.stateBehavior = (po.stateBehavior || "") + " OpenAsDialog";

            this.service.hooks.onOpen(po, false);
        }
        catch (e) {
            this.parent.setNotification(e);
        }
    }

    changeReference(selectedItems: QueryResultItem[] | string[]): Promise<boolean> {
        return this.parent.queueWork(async () => {
            if (this.isReadOnly)
                throw "Attribute is read-only.";

            this.parent[PersistentObjectSymbols.PrepareAttributesForRefresh](this);
            if (selectedItems.length && selectedItems.length > 0 && typeof selectedItems[0] === "string") {
                const selectedObjectIds = <string[]>selectedItems;
                selectedItems = selectedObjectIds.map(id => this.service.hooks.onConstructQueryResultItem(this.service, { id: id }, null));
            }

            const result = await this.service.executeAction("PersistentObject.SelectReference", this.parent, this.lookup, <QueryResultItem[]>selectedItems, { PersistentObjectAttributeId: this.id });
            if (result)
                this.parent[PersistentObjectSymbols.RefreshFromResult](result);

            return true;
        });
    }

    getPersistentObject(): Promise<PersistentObject> {
        if (!this.objectId)
            return Promise.resolve(null);

        return this.parent.queueWork(() => this.service.getPersistentObject(this.parent, this.lookup.persistentObject.id, this.objectId));
    }

    protected _refreshFromResult(resultAttr: Dto.PersistentObjectAttributeWithReference, resultWins: boolean): boolean {
        if (resultWins || this.objectId !== resultAttr.objectId) {
            this.#objectId = resultAttr.objectId;
            this.isValueChanged = resultAttr.isValueChanged;
        }

        const visibilityChanged = super._refreshFromResult(resultAttr, resultWins);

        this.#displayAttribute = resultAttr.displayAttribute;
        this.#canAddNewReference = resultAttr.canAddNewReference;
        this.#selectInPlace = resultAttr.selectInPlace;

        return visibilityChanged;
    }

    protected _toServiceObject(): any {
        return super._toServiceObject({
            "objectId": this.objectId,
            "displayAttribute": this.displayAttribute,
        });
    }
}