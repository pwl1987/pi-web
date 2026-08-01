export interface ModelOption {
  provider: string;
  modelId: string;
  name: string;
}

export const modelOptionCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function compareModelOptions(a: ModelOption, b: ModelOption): number {
  return (
    modelOptionCollator.compare(a.name || a.modelId, b.name || b.modelId) ||
    modelOptionCollator.compare(a.provider, b.provider) ||
    modelOptionCollator.compare(a.modelId, b.modelId)
  );
}
