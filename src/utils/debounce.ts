export interface DebouncedFunction<TArgs extends unknown[]> {
  (...args: TArgs): void;
  cancel(): void;
  flush(): void;
}

export function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  delayMs: number
): DebouncedFunction<TArgs> {
  let timeoutId: NodeJS.Timeout | undefined;
  let lastArgs: TArgs | undefined;

  const debounced = (...args: TArgs): void => {
    lastArgs = args;
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      timeoutId = undefined;
      const argsToCall = lastArgs;
      lastArgs = undefined;
      if (argsToCall !== undefined) {
        fn(...argsToCall);
      }
    }, delayMs);
  };

  debounced.cancel = (): void => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    lastArgs = undefined;
  };

  debounced.flush = (): void => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
      const argsToCall = lastArgs;
      lastArgs = undefined;
      if (argsToCall !== undefined) {
        fn(...argsToCall);
      }
    }
  };

  return debounced;
}

