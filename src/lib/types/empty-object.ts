declare const emptyObjectSymbol: unique symbol;

/**
 * Strictly empty plain object type.
 */
export type EmptyObject = { [emptyObjectSymbol]?: never };

export type IsEmptyObject<T> = T extends EmptyObject ? true : false;