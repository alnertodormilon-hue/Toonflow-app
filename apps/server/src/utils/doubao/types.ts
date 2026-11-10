export type AccountState = "needsLogin" | "active" | "needsVerification" | "disabled";
export type Account = {
  id: string;
  name: string;
  state: AccountState;
  identityHash?: string;
  sessionCipher?: string;
  createdAt: string;
  updatedAt: string;
};

export type Asset = { id: string; sha256: string; path: string; bytes: number; width: number; height: number };
export type JobState = "queued" | "preparing" | "needsLogin" | "needsConfirmation" | "needsVerification" | "submitting"
  | "submissionUnknown" | "awaitingTask" | "generating" | "downloading" | "downloadFailed" | "completed" | "failed" | "cancelled";
export type VideoIntent = {
  clientRequestId: string;
  accountId: string;
  model: "seedance_v2.0_mini";
  prompt: string;
  duration: 15;
  ratio: "9:16";
  resolution: "720p";
  assetIds: [string, string];
};
export type Job = VideoIntent & {
  id: string;
  intentHash: string;
  state: JobState;
  stateVersion: number;
  createdAt: string;
  updatedAt: string;
  message: string;
  errorCode?: string;
  initialSent: boolean;
  confirmationSent: boolean;
  canConfirmParameters?: boolean;
  confirmationLocalMessageId?: string;
  conversationId?: string;
  conversationType?: number;
  localMessageId?: string;
  questionId?: string;
  sectionId?: string;
  referenceUris?: string[];
  videoId?: string;
  outputPath?: string;
  bytes?: number;
  sha256?: string;
};

export const pendingStates: JobState[] = ["queued", "preparing", "needsLogin", "needsConfirmation", "needsVerification",
  "submitting", "submissionUnknown", "awaitingTask", "generating"];

export function invalid(message: string, status = 400, code = "INVALID_REQUEST"): never {
  throw Object.assign(new Error(message), { status, code });
}

export function object(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

export function canonical(text: string) {
  return text.replace(/\r\n?/g, "\n").trim();
}
