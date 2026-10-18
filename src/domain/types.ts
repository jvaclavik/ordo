export type StatusMeaning = "todo" | "doing" | "done" | "cancelled" | "none";
export type ItemType = "task" | "note";
export type Priority = "low" | "high" | "urgent";
export type ViewMode = "list" | "board" | "notes" | "calendar";
export type RecurrenceFreq = "daily" | "weekly" | "monthly" | "interval";
export type LinkKind = "related" | "taskFromNote";
export type FolderColor =
  | "c1"
  | "c2"
  | "c3"
  | "c4"
  | "c5"
  | "c6"
  | "c7"
  | "c8"
  | "c9"
  | "c10"
  | "c11"
  | "c12"
  | "c13"
  | "c14"
  | "c15"
  | "c16";

export type FolderPaint = FolderColor | `#${string}`;

export const FOLDER_COLORS: FolderColor[] = [
  "c1",
  "c2",
  "c3",
  "c4",
  "c5",
  "c6",
  "c7",
  "c8",
  "c9",
  "c10",
  "c11",
  "c12",
  "c13",
  "c14",
  "c15",
  "c16",
];

export const FOLDER_COLOR_LABELS: Record<FolderColor, string> = {
  c1: "Tealová",
  c2: "Rezavá",
  c3: "Zlatá",
  c4: "Modrá",
  c5: "Fialová",
  c6: "Zelená",
  c7: "Růžová",
  c8: "Kamenná",
  c9: "Meruňková",
  c10: "Karmínová",
  c11: "Blankytná",
  c12: "Indigová",
  c13: "Bobulová",
  c14: "Jablečná",
  c15: "Kobaltová",
  c16: "Hnědá",
};

export const FOLDER_COLOR_ORDER: FolderColor[] = [
  "c10",
  "c2",
  "c9",
  "c16",
  "c3",
  "c14",
  "c6",
  "c1",
  "c11",
  "c4",
  "c15",
  "c12",
  "c5",
  "c13",
  "c7",
  "c8",
];

export type Workspace = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
};

export type Folder = {
  id: string;
  workspaceId: string;
  parentId: string | null;
  name: string;
  icon: string | null;
  color: FolderPaint | null;
  keywords: string | null;
  sortOrder: string;
  system: "inbox" | null;
  defaultView: ViewMode;
  openStatusId: string | null;
  closedStatusId: string | null;
  isArchived: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Status = {
  id: string;
  workspaceId: string;
  folderId: string;
  name: string;
  meaning: StatusMeaning;
  sortOrder: string;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Item = {
  id: string;
  workspaceId: string;
  folderId: string;
  type: ItemType;
  title: string;
  body: string | null;
  statusId: string | null;
  priority: Priority | null;
  assigneeId: string | null;
  dueAt: string | null;
  dueHasTime: boolean;
  plannedFor: string | null;
  planUntil: string | null;
  parentItemId: string | null;
  seriesId: string | null;
  recurrenceFreq: RecurrenceFreq | null;
  recurrenceInterval: number | null;
  recurrenceWeekdays: string | null;
  recurrenceUntil: string | null;
  pristine: boolean;
  sortOrder: string;
  pinX: number | null;
  pinY: number | null;
  pinZ: number | null;
  pinW: number | null;
  pinH: number | null;
  isPinned: boolean;
  isArchived: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Tag = {
  id: string;
  workspaceId: string;
  name: string;
  color: FolderPaint | null;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ItemTag = {
  id: string;
  workspaceId: string;
  itemId: string;
  tagId: string;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Person = {
  id: string;
  workspaceId: string;
  name: string;
  color: FolderColor | null;
  emoji: string | null;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Dependency = {
  id: string;
  workspaceId: string;
  itemId: string;
  dependsOnId: string;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ItemLink = {
  id: string;
  workspaceId: string;
  fromId: string;
  toId: string;
  kind: LinkKind;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ViewGroup = "status" | "priority" | "assignee" | "folder" | "none";

export type ViewQuery = {
  folderId: string | null;
  includeDescendants: boolean;
  type: ItemType | null;
  openOnly: boolean;
  tagId: string | null;
  assigneeId: string | null;
  groupBy: ViewGroup;
  text: string | null;
};

export type SavedView = {
  id: string;
  workspaceId: string;
  folderId: string | null;
  name: string;
  query: ViewQuery;
  sortOrder: string;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Rule = {
  id: string;
  workspaceId: string;
  enabled: boolean;
  sortOrder: string;
  matchText: string | null;
  matchTagId: string | null;
  actionFolderId: string;
  actionStatusId: string | null;
  actionTagId: string | null;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Db = {
  version: 1;
  workspaces: Workspace[];
  folders: Folder[];
  statuses: Status[];
  items: Item[];
  tags: Tag[];
  itemTags: ItemTag[];
  people: Person[];
  dependencies: Dependency[];
  itemLinks: ItemLink[];
  savedViews: SavedView[];
  rules: Rule[];
};

export type FolderPatch = {
  name?: string;
  icon?: string | null;
  color?: FolderPaint | null;
  keywords?: string | null;
  defaultView?: ViewMode;
  openStatusId?: string | null;
  closedStatusId?: string | null;
  isArchived?: boolean;
};

export type ItemPatch = {
  title?: string;
  body?: string | null;
  type?: ItemType;
  priority?: Priority | null;
  assigneeId?: string | null;
  dueAt?: string | null;
  dueHasTime?: boolean;
  plannedFor?: string | null;
  planUntil?: string | null;
  parentItemId?: string | null;
  sortOrder?: string;
  pinX?: number | null;
  pinY?: number | null;
  pinZ?: number | null;
  pinW?: number | null;
  pinH?: number | null;
  isPinned?: boolean;
  isArchived?: boolean;
};

export type NewItem = {
  id: string;
  folderId: string;
  type: ItemType;
  title: string;
  body: string | null;
  statusId: string | null;
  priority: Priority | null;
  assigneeId: string | null;
  dueAt: string | null;
  dueHasTime: boolean;
  plannedFor: string | null;
  planUntil: string | null;
  parentItemId: string | null;
  sortOrder: string;
  applyRules: boolean;
  tagIds: string[];
};

export type Ctx = {
  now: string;
  today: string;
  id: () => string;
};
