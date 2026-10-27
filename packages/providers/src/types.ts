export type ProviderCapability =
  | "textToImage"
  | "imageToImage"
  | "textSuggestion"
  | "asyncQuery"
  | "cancel"
  | "idempotentSubmit";
export type ProviderInput = {
  operationId: string;
  modelVersionId: string;
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  count: 1;
  referenceObjectIds?: string[];
  referenceStrength?: number;
  seed?: number;
  consentRef?: string;
};
export type SubmitResult =
  | { state: "accepted"; providerRequestId: string; acceptedAt: string }
  | { state: "rejected"; code: string; message: string }
  | { state: "unknown"; operationId: string; retryAfterSeconds: number };
export type QueryResult =
  | {
      state: "queued" | "running" | "cancel_requested" | "unknown";
      providerRequestId: string;
      retryAfterSeconds: number;
    }
  | {
      state: "succeeded";
      providerRequestId: string;
      outputs: Array<{
        url: string;
        mime: "image/jpeg" | "image/png";
        sha256?: string;
      }>;
      costFen: number;
    }
  | {
      state: "failed" | "cancelled" | "rejected";
      providerRequestId: string;
      code: string;
      message: string;
    };
export interface ProviderReceiptStore {
  claim(operationId: string): Promise<boolean>;
  read(operationId: string): Promise<QueryResult | null>;
  write(operationId: string, result: QueryResult): Promise<void>;
}
export type ProviderContext = {
  connectionVersionId: string;
  secretRef: string;
  secretVersion: string;
  endpoint: string;
  allowedResultHosts: string[];
  providerModelId?: string;
  readSecret?: () => Promise<string>;
  receipts?: ProviderReceiptStore;
  persistInline?: (
    bytes: Uint8Array,
    mime: string,
    operationId: string,
  ) => Promise<{ url: string; sha256: string }>;
  readReference?: (id: string) => Promise<{ bytes: Uint8Array; mime: string }>;
  estimatedCostFen?: number;
  signal?: AbortSignal;
};
export interface ProviderAdapter {
  readonly id: string;
  readonly version: string;
  readonly capabilities: ReadonlySet<ProviderCapability>;
  readonly mode: "replay" | "live";
  submit(input: ProviderInput, context: ProviderContext): Promise<SubmitResult>;
  query(
    identity: { operationId: string; providerRequestId: string | null },
    context: ProviderContext,
  ): Promise<QueryResult>;
  cancel(
    identity: { operationId: string; providerRequestId: string | null },
    context: ProviderContext,
  ): Promise<QueryResult>;
}
export type TextSuggestionInput = {
  operationId: string;
  modelVersionId: string;
  prompt: string;
  maxCharacters: number;
};
export type TextSuggestionResult =
  | { state: "succeeded"; text: string; costFen: number }
  | { state: "rejected"; code: string }
  | { state: "unknown"; operationId: string };
export interface TextSuggestionAdapter {
  suggest(
    input: TextSuggestionInput,
    context: ProviderContext,
  ): Promise<TextSuggestionResult>;
}
export function checkProviderInput(
  input: ProviderInput,
  capabilities: ReadonlySet<ProviderCapability>,
) {
  if (
    input.count !== 1 ||
    !input.operationId ||
    !input.prompt ||
    input.prompt.length > 20000 ||
    ![input.width, input.height].every(
      (v) => Number.isSafeInteger(v) && v > 0 && v <= 20000,
    )
  )
    throw Error("PROVIDER_INPUT_INVALID");
  if (
    input.seed !== undefined ||
    input.referenceStrength !== undefined ||
    input.negativePrompt !== undefined
  )
    throw Error("UNSUPPORTED_PARAMETER");
  if (input.referenceObjectIds?.length && !capabilities.has("imageToImage"))
    throw Error("UNSUPPORTED_CAPABILITY");
  if (input.referenceObjectIds?.length && !input.consentRef)
    throw Error("REFERENCE_CONSENT_REQUIRED");
}
