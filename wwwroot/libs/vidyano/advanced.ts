import type { PersistentObject } from "./persistent-object";
import type { PersistentObjectAttribute } from "./persistent-object-attribute";
import type { Query } from "./query";
import type { Dto } from "./vidyano";

export const PersistentObjectSymbols = {
    Dto: Symbol("PersistentObject_Dto"),
    IsPersistentObject: Symbol("PersistentObject_IsPersistentObject"),
    PrepareAttributesForRefresh: Symbol("PersistentObject_PrepareAttributesForRefresh"),
    RefreshFromResult: Symbol("PersistentObject_RefreshFromResult"),
    RefreshTabsAndGroups: Symbol("PersistentObject_RefreshTabsAndGroups"),
};

export const PersistentObjectAttributeSymbols = {
    IsPersistentObjectAttribute: Symbol("PersistentObjectAttribute_IsPersistentObjectAttribute"),
    RefreshFromResult: Symbol("PersistentObjectAttribute_RefreshFromResult"),
    ToServiceObject: Symbol("PersistentObjectAttribute_ToServiceObject"),
};

export const QuerySymbols = {
    IsQuery: Symbol("Query_IsQuery"),
};

// const AdvancedProxy = Symbol("AdvancedProxy");

// export type AdvancedPersistentObject = PersistentObject & {
//     get dto(): Dto.PersistentObject;
//     prepareAttributesForRefresh(sender: PersistentObjectAttribute): void;
//     refreshFromResult(po: PersistentObject | Dto.PersistentObject, resultWins?: boolean): void;
//     refreshTabsAndGroups(...changedAttributes: PersistentObjectAttribute[]): void;
// };

// export type AdvancedPersistentObjectAttribute = PersistentObjectAttribute & {
//     refreshFromResult(attr: PersistentObjectAttribute | Dto.PersistentObjectAttribute, resultWins?: boolean): boolean;
//     toServiceObject(): Dto.PersistentObjectAttribute;
// };

// export type AdvancedQuery = Query & {
// };

// export function advanced(target: PersistentObject): AdvancedPersistentObject;
// export function advanced(target: PersistentObjectAttribute): AdvancedPersistentObjectAttribute;
// export function advanced(target: Query): AdvancedQuery;
// export function advanced(target: any) {
//     if (target[AdvancedProxy])
//         return target;

//     if (target[PersistentObjectSymbols.IsPersistentObject]) {
//         return target[AdvancedProxy] = new Proxy(target, {
//             get: (obj, prop, receiver) => {
//                 switch (prop) {
//                     case "dto":
//                         return obj[PersistentObjectSymbols.Dto];

//                     case "prepareAttributesForRefresh":
//                         return (...args: any[]) => obj[PersistentObjectSymbols.PrepareAttributesForRefresh].apply(obj, args);

//                     case "refreshFromResult":
//                         return (...args: any[]) => obj[PersistentObjectSymbols.RefreshFromResult].apply(obj, args);
                    
//                     case "refreshTabsAndGroups":
//                         return (...args: any[]) => obj[PersistentObjectSymbols.RefreshTabsAndGroups].apply(obj, args);

//                     default:
//                         return Reflect.get(obj, prop, receiver);
//                 };
//             }
//         }) as AdvancedPersistentObject;
//     } else if (target[PersistentObjectAttributeSymbols.IsPersistentObjectAttribute]) {
//         return target[AdvancedProxy] = new Proxy(target, {
//             get: (obj, prop, receiver) => {
//                 switch (prop) {
//                     case "refreshFromResult":
//                         return (...args: any[]) => obj[PersistentObjectAttributeSymbols.RefreshFromResult].apply(obj, args);

//                     case "toServiceObject":
//                         return (...args: any[]) => obj[PersistentObjectAttributeSymbols.ToServiceObject].apply(obj, args);

//                     default:
//                         return Reflect.get(obj, prop, receiver);
//                 };
//             }
//         }) as AdvancedPersistentObjectAttribute;
//     } else if (target[QuerySymbols.IsQuery]) {
//         return target[AdvancedProxy] = new Proxy(target, {
//             get: (obj, prop, receiver) => {
//                 switch (prop) {
//                     default:
//                         return Reflect.get(obj, prop, receiver);
//                 };
//             }
//         }) as AdvancedPersistentObjectAttribute;
//     } else
//         throw new Error("Invalid target");
// }