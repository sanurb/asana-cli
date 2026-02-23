export type QueryParamPrimitive = string | number | boolean | null | undefined;

// allow: ?a=1&b=true&c=hello&d=1&d=2
export type QueryParamValue =
  | QueryParamPrimitive
  | readonly QueryParamPrimitive[];

export type QueryParams = Record<string, QueryParamValue>;