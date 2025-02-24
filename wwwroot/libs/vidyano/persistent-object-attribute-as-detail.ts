import type * as Dto from "./typings/service.js"
import type { PersistentObject } from "./persistent-object.js"
import { PersistentObjectAttribute } from "./persistent-object-attribute.js"
import type { Query } from "./query.js"
import type { Service } from "./service.js"

export class PersistentObjectAttributeAsDetail extends PersistentObjectAttribute {
    private _objects: PersistentObject[];
    details: Query;
    lookupAttribute: string;

    constructor(service: Service, attr: any, public parent: PersistentObject) {
        super(service, attr, parent);

        if (attr.details)
            this.details = this.service.hooks.onConstructQuery(service, attr.details, parent, false, 1);
        else
            this.details = null;

        if (attr.objects) {
            this._objects = attr.objects.map(po => {
                const detailObj = this.service.hooks.onConstructPersistentObject(service, po);
                detailObj.parent = this.parent;
                detailObj.ownerDetailAttribute = this;

                return detailObj;
            });
        }
        else
            this._objects = [];

        this.parent.propertyChanged.attach((sender, args) => {
            if (args.propertyName === "isEditing" && args.newValue)
                this.objects.forEach(o => o.beginEdit());
            else if (args.propertyName === "isFrozen") {
                if (args.newValue)
                    this.objects.forEach(obj => obj.freeze());
                else
                    this.objects.forEach(obj => obj.unfreeze());
            }
        });

        this.lookupAttribute = attr.lookupAttribute;
    }

    get objects(): PersistentObject[] {
        return this._objects;
    }
    private _setObjects(objects: PersistentObject[]) {
        if (objects === this._objects) {
            if (!!objects && objects.length === this._objects.length) {
                let hasDifferences: boolean;
                for (let n = 0; n < objects.length; n++) {
                    if (objects[n] !== this.objects[n]) {
                        hasDifferences = true;
                        break;
                    }
                }

                if (!hasDifferences)
                    return;
            }
        }

        const oldObjects = this.objects;
        this.notifyPropertyChanged("objects", this._objects = objects, oldObjects);
    }

    async newObject(): Promise<PersistentObject> {
        const po = await this.details.actions["New"].execute({ throwExceptions: true, skipOpen: true });
        if (!po)
            return null;

        po.ownerQuery = null;
        po.ownerDetailAttribute = this;

        return po;
    }

    _refreshFromResult(resultAttr: Dto.PersistentObjectAttributeAsDetail, resultWins: boolean): boolean {
        const visibilityChanged = super._refreshFromResult(resultAttr, resultWins);

        if (this.objects != null && resultAttr.objects != null) {
            if (resultAttr.objects) {
                this._objects = resultAttr.objects.map(po => {
                    const detailObj = this.service.hooks.onConstructPersistentObject(this.service, po);
                    detailObj.parent = this.parent;
                    detailObj.ownerDetailAttribute = this;

                    if (this.parent.isEditing)
                        detailObj.beginEdit();
    
                    return detailObj;
                });
            }
            else
                this._setObjects([]);
        }

        return visibilityChanged;
    }

    _toServiceObject() {
        const result = super._toServiceObject();

        if (this.objects != null) {
            result.objects = this.objects.map(obj => {
                const detailObj = obj.toServiceObject(true);
                if (obj.isDeleted)
                    detailObj.isDeleted = true;

                return detailObj;
            });
        }

        return result;
    }

    async onChanged(allowRefresh: boolean): Promise<any> {
        if (!this.parent.isEditing || this.isReadOnly)
            return this.value;

        this.parent.triggerDirty();
        if (this.triggersRefresh) {
            if (allowRefresh)
                await this.triggerRefresh();
            else
                this._shouldRefresh = true;
        }

        return this.value;
    }
}