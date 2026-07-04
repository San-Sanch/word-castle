// Minimal typings for Node's built-in test runner and assert,
// used because @types/node is unavailable in the offline npm cache.
declare module 'node:test' {
  type TestFn = (t?: unknown) => void | Promise<void>
  export function test(name: string, fn: TestFn): void
  export function describe(name: string, fn: () => void): void
  export function it(name: string, fn: TestFn): void
}

declare module 'node:assert/strict' {
  interface Assert {
    (value: unknown, message?: string): asserts value
    equal(actual: unknown, expected: unknown, message?: string): void
    notEqual(actual: unknown, expected: unknown, message?: string): void
    deepEqual(actual: unknown, expected: unknown, message?: string): void
    ok(value: unknown, message?: string): asserts value
    throws(fn: () => unknown, message?: string): void
    match(value: string, re: RegExp, message?: string): void
    doesNotMatch(value: string, re: RegExp, message?: string): void
  }
  const assert: Assert
  export default assert
}
