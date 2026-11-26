const R = window.React;
function make(type, props, key) {
  const { children, ...rest } = props || {};
  if (key !== undefined) rest.key = key;
  if (children === undefined) return R.createElement(type, rest);
  return Array.isArray(children) ? R.createElement(type, rest, ...children) : R.createElement(type, rest, children);
}
function one(type, props, key) {
  const { children, ...rest } = props || {};
  if (key !== undefined) rest.key = key;
  return children === undefined ? R.createElement(type, rest) : R.createElement(type, rest, children);
}
export const jsx = one, jsxs = make, jsxDEV = one, Fragment = R.Fragment;
