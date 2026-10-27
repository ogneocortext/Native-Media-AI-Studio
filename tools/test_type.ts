export type Setter<T> = (value: T | ((prev: T) => T)) => void;

export type VisualizerStateSetters = {
  setBgColor: Setter<string>;
};

export function useVisualizerState() {
  return { a: 1 } as never;
}
