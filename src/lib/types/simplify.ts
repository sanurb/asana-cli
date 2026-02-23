/**
 * Flatten type output to improve editor hints and turn interfaces into sealed types.
 */
export type Simplify<T> = { [K in keyof T]: T[K] } & {};