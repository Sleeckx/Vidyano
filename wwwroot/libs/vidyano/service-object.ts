import { Observable } from "./common/observable.js"
import type { Service } from "./service.js"

/**
 * Represents a base class for objects that are used by the backend service.
 * This class provides common functionality for service objects, such as
 * copying properties to another object. It extends the Observable class
 * to support reactive programming patterns.
 */
export abstract class ServiceObject extends Observable<ServiceObject> {
    constructor(public service: Service) {
        super();
    }

    /**
     * Copy properties from this object to another object.
     * @param propertyNames The names of the properties to copy.
     * @param includeNullValues Include null values in the result.
     * @param result The object to copy the properties to.
     * @returns The object with the properties copied.
     */
    copyProperties(propertyNames: Array<string>, includeNullValues?: boolean, result?: any): any {
        result = result || {};
        propertyNames.forEach(p => {
            const value = (this as any)[p];
            if (includeNullValues || (value != null && value !== false && (value !== 0 || p === "pageSize") && (!Array.isArray(value) || value.length > 0)))
                result[p] = value;
        });
        return result;
    }
}