export type ReferentialAction =
  | "cascade"
  | "restrict"
  | "no action"
  | "set null"
  | "set default";

export type Reference = {
  table: string;
  column: string;
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
  deferrable?: boolean;
};

export type DefaultValue =
  | { kind: "value"; value: unknown }
  | { kind: "expression"; text: string };

export type Identity = {
  always: boolean;
  start?: number;
  increment?: number;
};

export type ColumnDef = {
  type: string;
  enum?: boolean;
  array: number;
  notNull: boolean;
  primaryKey: boolean;
  unique: boolean;
  default?: DefaultValue;
  identity?: Identity;
  generated?: string;
  references?: Reference;
  collate?: string;
  check?: string;
  comment?: string;
};

export type IndexMember = {
  expression: string;
  column?: string;
  direction?: "asc" | "desc";
  nulls?: "first" | "last";
};

export type IndexDef = {
  name: string;
  unique: boolean;
  using?: string;
  members: IndexMember[];
  where?: string;
  include?: string[];
  nullsNotDistinct?: boolean;
  concurrently?: boolean;
};

export type ConstraintDef =
  | { kind: "primaryKey"; name: string; columns: string[] }
  | {
      kind: "unique";
      name: string;
      columns: string[];
      nullsNotDistinct?: boolean;
    }
  | {
      kind: "foreignKey";
      name: string;
      columns: string[];
      table: string;
      references: string[];
      onDelete?: ReferentialAction;
      onUpdate?: ReferentialAction;
      deferrable?: boolean;
    }
  | { kind: "check"; name: string; expression: string };

export type TableDef = {
  name: string;
  schema?: string;
  columns: Record<string, ColumnDef>;
  order: string[];
  indexes: IndexDef[];
  constraints: ConstraintDef[];
  comment?: string;
};

export type EnumDef = { name: string; values: string[] };

export type ExtensionDef = { name: string };

export type SequenceDef = {
  name: string;
  type?: string;
  start?: number;
  increment?: number;
};

export type ViewDef = {
  name: string;
  materialized: boolean;
  query: string;
  columns: string[];
};

export type SchemaState = {
  tables: Record<string, TableDef>;
  enums: Record<string, EnumDef>;
  extensions: Record<string, ExtensionDef>;
  schemas: Record<string, { name: string }>;
  sequences: Record<string, SequenceDef>;
  views: Record<string, ViewDef>;
};

export function emptyState(): SchemaState {
  return {
    tables: {},
    enums: {},
    extensions: {},
    schemas: {},
    sequences: {},
    views: {},
  };
}
