export interface PresetSaveOptions {
  name: string;
  tags?: string[];
  folder?: string;
  description?: string;
  includeIntrinsics?: boolean;
}

export interface PresetApplyOptions {
  presetId: string;
  clearExisting?: boolean;
}

export interface PresetListFilter {
  folder?: string;
  tag?: string;
  search?: string;
}
