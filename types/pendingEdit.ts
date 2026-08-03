export type EditStatus = 'pending' | 'applied' | 'dismissed';

export interface PendingEdit {
  id: string;
  search: string;
  replace: string;
  status: EditStatus;
  model?: string;
}
