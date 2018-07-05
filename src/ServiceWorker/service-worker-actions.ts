﻿namespace Vidyano {
    export class ServiceWorkerActions {
        private static _types = new Map<string, any>();
        static async get<T>(name: string, db: IndexedDB): Promise<ServiceWorkerActions> {
            if (!(/^\w+$/.test(name))) {
                const classNameRecord = await db.load(name, "ActionClassesById");
                if (!classNameRecord)
                    return null;

                name = classNameRecord.name;
            }

            let actionsClass = ServiceWorkerActions._types.get(name);
            if (actionsClass === undefined) {
                try {
                    actionsClass = eval.call(null, `ServiceWorker${name}Actions`);
                }
                catch (e) {
                    const className = await db.load(name, "ActionClassesById");
                    if (className) {
                        try {
                            actionsClass = eval.call(null, `ServiceWorker${className}Actions`);
                        }
                        catch (ee) {
                            actionsClass = null;
                        }
                    }
                    else
                        actionsClass = null;
                }
                finally {
                    ServiceWorkerActions._types.set(name, actionsClass);
                }
            }

            const instance = new (actionsClass || ServiceWorkerActions)();
            instance._db = db;

            return instance;
        }

        private _db: IndexedDB;

        get db(): IndexedDB {
            return this._db;
        }

        private _isPersistentObject(arg: any): arg is IPersistentObject {
            return (arg as IPersistentObject).type !== undefined;
        }

        private _isQuery(arg: any): arg is IQuery {
            return (arg as IQuery).persistentObject !== undefined;
        }

        async onCache<T extends IPersistentObject | IQuery>(persistentObjectOrQuery: T): Promise<void> {
            if (this._isPersistentObject(persistentObjectOrQuery))
                await this.onCachePersistentObject(persistentObjectOrQuery);
            else if (this._isQuery(persistentObjectOrQuery))
                await this.onCacheQuery(persistentObjectOrQuery);
        }

        async onCachePersistentObject(persistentObject: IPersistentObject): Promise<void> {
            await this.db.save({
                id: persistentObject.id,
                response: JSON.stringify(persistentObject)
            }, "PersistentObjects");

            await this.db.save({
                id: persistentObject.id,
                name: persistentObject.type
            }, "ActionClassesById");
        }

        async onCacheQuery(query: IQuery): Promise<void> {
            await this.db.save({
                id: query.id,
                response: JSON.stringify(query)
            }, "Queries");

            await this.db.save({
                id: query.id,
                name: query.persistentObject.type
            }, "ActionClassesById");

            await this.db.save({
                id: query.persistentObject.id,
                query: query.id,
                response: JSON.stringify(query.persistentObject)
            }, "PersistentObjects");

            await this.db.save({
                id: query.persistentObject.id,
                name: query.persistentObject.type
            }, "ActionClassesById");
        }

        async getOwnerQuery(objOrId: IPersistentObject | string): Promise<IQuery> {
            if (typeof objOrId === "object")
                objOrId = (objOrId as IPersistentObject).id;

            const record = await this.db.load(objOrId, "PersistentObjects");
            if (record == null || !record.query)
                return null;

            const queryRecord = await this.db.load(record.query, "Queries");
            if (!queryRecord)
                return null;

            const query: IQuery = JSON.parse(queryRecord.response);
            if (!query)
                return null;

            return query;
        }

        async onGetPersistentObject(parent: IPersistentObject, id: string, objectId?: string, isNew?: boolean): Promise<IPersistentObject> {
            const record = await this.db.load(id, "PersistentObjects");
            if (record == null || !record.query)
                return null;

            const query = await this.getOwnerQuery(id);

            const resultItem = query.result.items.find(i => i.id === objectId);
            if (!resultItem)
                return null;

            const po: IPersistentObject = JSON.parse(record.response);
            po.objectId = objectId;
            po.isNew = isNew;
            po.actions = (po.actions || []);
            if (query.actions.indexOf("BulkEdit") >= 0 && po.actions.indexOf("Edit") < 0)
                po.actions.push("Edit");

            po.attributes.forEach(attr => {
                const value = resultItem.values.find(v => v.key === attr.name);
                if (value == null)
                    return;

                attr.value = value.value;
            });

            const breadcrumbRE = /{([^{]+?)}/;
            do {
                const m = breadcrumbRE.exec(po.breadcrumb);
                if (!m)
                    break;

                const attribute = po.attributes.find(a => a.name === m[1]);
                if (!attribute)
                    continue;

                po.breadcrumb = po.breadcrumb.replace(m[0], attribute.value);
            } while (true);

            return po;
        }

        async onGetQuery(id: string): Promise<IQuery> {
            const cache = await this.db.load(id, "Queries");
            const query: IQuery = cache ? JSON.parse(cache.response) : null;
            if (!query)
                return null;

            query.columns.forEach(c => c.canFilter = c.canListDistincts = c.canGroupBy = false);
            query.filters = null;

            if (this.onFilter === ServiceWorkerActions.prototype.onFilter) {
                const filterIndex = query.actions.indexOf("Filter");
                if (filterIndex >= 0)
                    query.actions.splice(filterIndex, 1);
            }

            return query;
        }

        async onExecuteQuery(query: IQuery): Promise<IQueryResult> {
            const cachedQuery = await this.onGetQuery(query.id);
            const columnMap = new Map(query.columns.map((c): [string, IQueryColumn] => [c.name, c]).concat(query.columns.map((c): [string, IQueryColumn] => [c.label, c])));

            const result: IQueryResult = {
                columns: query.columns,
                items: cachedQuery.result.items,
                sortOptions: query.sortOptions,
                charts: cachedQuery.result.charts
            };

            if (this.onFilter !== ServiceWorkerActions.prototype.onFilter)
                result.items = this.onFilter(query);

            return result
        }

        protected onFilter(query: IQuery): IQueryResultItem[] {
            throw "Not implemented";
        }

        async onExecuteQueryFilterAction(action: string, query: IQuery, parameters: Service.ExecuteActionParameters): Promise<IPersistentObject> {
            throw "Not implemented";
        }

        async onExecuteQueryAction(action: string, query: IQuery, selectedItems: IQueryResultItem[], parameters: Service.ExecuteActionParameters): Promise<IPersistentObject> {
            if (action === "New")
                return this.onNew(query);

            return null;
        }

        async onExecutePersistentObjectAction(action: string, persistentObject: IPersistentObject, parameters: Service.ExecuteActionParameters): Promise<IPersistentObject> {
            if (action === "Save")
                return this.onSave(persistentObject);

            return null;
        }

        async onNew(query: IQuery): Promise<IPersistentObject> {
            const cache = await this.db.load(query.id, "Queries");
            const cachedQuery = cache ? <IQuery>JSON.parse(cache.response) : null;
            if (!query || !cachedQuery)
                return null;

            const newPo = cachedQuery.persistentObject;
            newPo.actions = ["Edit"];
            newPo.isNew = true;
            newPo.breadcrumb = newPo.newBreadcrumb || `New ${newPo.label}`;
            return newPo;
        }

        async onSave(obj: IPersistentObject): Promise<IPersistentObject> {
            if (obj.isNew)
                return this.saveNew(obj);

            return this.saveExisting(obj);
        }

        async saveNew(obj: IPersistentObject): Promise<IPersistentObject> {
            obj.objectId = `SW-NEW-${Date.now()}`;

            const query = await this.getOwnerQuery(obj);
            if (!query)
                throw `No associated query found for Persistent Object with id ${obj.id}`;

            await this.editQueryResultItemValues(query, obj, "New");

            obj.attributes.forEach(attr => attr.isValueChanged = false);
            obj.isNew = false;

            return obj;
        }

        async saveExisting(obj: IPersistentObject): Promise<IPersistentObject> {
            const poCache = await this.db.load(obj.id, "PersistentObjects");
            const queryCache = await this.db.load(poCache.query, "Queries");
            const query = JSON.parse(queryCache.response);

            await this.editQueryResultItemValues(query, obj, "Edit");

            queryCache.response = JSON.stringify(query);
            await this.db.save(queryCache, "Queries");

            obj.attributes.forEach(attr => attr.isValueChanged = false);

            return obj;
        }

        async editQueryResultItemValues(query: IQuery, persistentObject: IPersistentObject, changeType: ItemChangeType) {
            for (let attribute of persistentObject.attributes.filter(a => a.isValueChanged)) {
                let item = query.result.items.find(i => i.id === persistentObject.objectId);
                if (!item && changeType === "New") {
                    item = {
                        id: attribute.objectId,
                        values: []
                    };

                    query.result.items.push(item);
                    query.result.totalItems++;
                }

                if (!item)
                    throw "Unable to resolve item.";

                let value = item.values.find(v => v.key === attribute.name);
                if (!value) {
                    value = {
                        key: attribute.name,
                        value: attribute.value
                    };
                }
                else
                    value.value = attribute.value;

                const attributeMetaData = query.persistentObject.attributes.find(a => a.name === attribute.name);
                if (attributeMetaData && attributeMetaData.lookup) {
                    value.persistentObjectId = attributeMetaData.lookup.persistentObject.id;
                    value.objectId = attribute.objectId;
                }
            }
        }
    }

    export type ItemChangeType = "None" | "New" | "Edit" | "Delete";

    export interface IItemChange {
        objectId: string;
        key: string;
        value: string;
        referenceObjectId?: string;
        logChange?: boolean;
        type?: ItemChangeType;
    }
}