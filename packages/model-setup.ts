export type SetupRole = 'image' | 'video' | 'chat';
export type ModelSetup = {
  mode: 'recommended' | 'manual';
  defaults: Partial<Record<SetupRole, string>>;
  revision: number;
  updatedAt?: string;
};
export type ModelSetupChoice = {
  role: SetupRole;
  modelId: string;
  name: string;
  provider: 'chuhe' | 'token01';
  group: string;
  reason: string;
};
export type ModelSetupPreview = {
  settings: ModelSetup;
  applied: boolean;
  choices: ModelSetupChoice[];
  availableCounts: Record<SetupRole, number>;
  missing: SetupRole[];
  signature: string;
};
