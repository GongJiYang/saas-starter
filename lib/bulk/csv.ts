import { parse } from 'csv-parse/sync';
import {
  CSV_ALL_COLUMNS,
  CSV_LEGACY_TEMPLATE_VERSION,
  CSV_MAX_ROWS,
  CSV_TEMPLATE_VERSION,
  type CsvTemplateVersion,
  type ReadinessIssue,
  validateCsvHeaders,
  validateSkuReadiness,
} from './contracts';

export type CsvImportIssue = Omit<ReadinessIssue, 'code'> & {
  code: string;
  rowNumber?: number;
};

export type BrandKitOption = {
  id: number;
  name: string;
};

export type CsvNormalizationContext = {
  version: CsvTemplateVersion;
  brandKits: readonly BrandKitOption[];
  workspaceName: string;
};

export type CsvParseOptions = {
  expectedVersion?: CsvTemplateVersion;
  brandKits?: readonly BrandKitOption[];
  workspaceName?: string;
};

export type NormalizedCsvRow = {
  externalSku: string;
  productName: string;
  category: string;
  primaryImageUrl: string;
  productPageUrl?: string;
  detailImageUrls: string[];
  approvedClaims: Array<{ text: string; source: string }>;
  prohibitedClaims: string[];
  mustShowElements: string[];
  immutableElements: string[];
  targetAudience: string;
  campaignGoal: string;
  platform: string;
  durationSeconds: number;
  brandKitId: number;
  brandKitName: string;
  cta: string;
  referenceVideoUrl?: string;
  referenceRights?: 'owned' | 'licensed' | 'inspiration_only';
  referenceMode?: 'none' | 'structure' | 'owned_template';
  notes?: string;
};

export type ParsedCsvRow = {
  rowNumber: number;
  rawValues: Record<string, string>;
  normalizedValues: NormalizedCsvRow | null;
  issues: CsvImportIssue[];
  readinessStatus: 'ready' | 'needs_input';
};

export type ParsedCsvDocument = {
  version: string | null;
  headers: string[];
  rows: ParsedCsvRow[];
  issues: CsvImportIssue[];
};
function issue(code: string, field: string, message: string): CsvImportIssue {
  return { code, field, message };
}

function templateVersionFromComments(text: string): string | null {
  const firstComment = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('#'));

  const match = firstComment?.match(/^#\s*csv_template_version\s*=\s*(\S+)\s*$/i);
  return match?.[1] ?? null;
}

function trimRecord(headers: readonly string[], values: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    headers.map((header, index) => [header, (values[index] ?? '').trim()]),
  );
}

function value(record: Record<string, string>, column: string): string {
  return record[column]?.trim() ?? '';
}

function optionalValue(record: Record<string, string>, column: string): string | undefined {
  const result = value(record, column);
  return result || undefined;
}

function expandedValues(record: Record<string, string>, prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => value(record, `${prefix}_${index + 1}`))
    .filter(Boolean);
}

function availableBrandKitNames(brandKits: readonly BrandKitOption[]): string {
  return brandKits.length > 0
    ? [...brandKits].sort((left, right) => left.name.localeCompare(right.name)).map((kit) => kit.name).join(', ')
    : 'none';
}

export function resolveBrandKitForWorkspace(
  csvValue: string,
  context: Pick<CsvNormalizationContext, 'brandKits' | 'workspaceName'>,
): { brandKitId: number; brandKitName: string; issue?: CsvImportIssue } {
  const name = csvValue.trim();
  const matches = context.brandKits.filter((kit) => kit.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase());
  if (matches.length === 1) {
    return { brandKitId: matches[0].id, brandKitName: matches[0].name };
  }
  const available = availableBrandKitNames(context.brandKits);
  if (matches.length > 1) {
    return {
      brandKitId: 0,
      brandKitName: name,
      issue: issue(
        'ambiguous_brand_kit_name',
        'brand_kit_name',
        `CSV Brand Kit "${name}" is ambiguous in Workspace "${context.workspaceName}". Available Brand Kits: ${available}.`,
      ),
    };
  }
  return {
    brandKitId: 0,
    brandKitName: name,
    issue: issue(
      'unknown_brand_kit_name',
      'brand_kit_name',
      `CSV Brand Kit "${name || '(blank)'}" is not available in Workspace "${context.workspaceName}". Available Brand Kits: ${available}.`,
    ),
  };
}

function resolveLegacyBrandKit(
  csvValue: string,
  context: Pick<CsvNormalizationContext, 'brandKits' | 'workspaceName'>,
): { brandKitId: number; brandKitName: string; issue?: CsvImportIssue } {
  const brandKitId = Number(csvValue);
  const match = Number.isSafeInteger(brandKitId)
    ? context.brandKits.find((kit) => kit.id === brandKitId)
    : undefined;
  if (match) return { brandKitId: match.id, brandKitName: match.name };
  return {
    brandKitId: 0,
    brandKitName: '',
    issue: issue(
      'brand_kit_not_in_workspace',
      'brand_kit_id',
      `CSV Brand Kit ID "${csvValue || '(blank)'}" is not available in Workspace "${context.workspaceName}". Available Brand Kits: ${availableBrandKitNames(context.brandKits)}.`,
    ),
  };
}

function normalizeRow(
  record: Record<string, string>,
  context: CsvNormalizationContext,
): { normalizedValues: NormalizedCsvRow; mappingIssue?: CsvImportIssue } {
  const approvedClaims = Array.from({ length: 5 }, (_, index) => {
    const text = value(record, `approved_claim_${index + 1}`);
    const source = value(record, `approved_claim_source_${index + 1}`);
    return text || source ? { text, source } : null;
  }).filter((claim): claim is { text: string; source: string } => claim !== null);

  const referenceVideoUrl = optionalValue(record, 'reference_video_url');
  const referenceRights = optionalValue(record, 'reference_rights') as NormalizedCsvRow['referenceRights'];
  const referenceMode = optionalValue(record, 'reference_mode') as NormalizedCsvRow['referenceMode'];
  const brandKit = context.version === CSV_LEGACY_TEMPLATE_VERSION
    ? resolveLegacyBrandKit(value(record, 'brand_kit_id'), context)
    : resolveBrandKitForWorkspace(value(record, 'brand_kit_name'), context);

  return {
    normalizedValues: {
      externalSku: value(record, 'external_sku'),
      productName: value(record, 'product_name'),
      category: value(record, 'category'),
      primaryImageUrl: value(record, 'primary_image_url'),
      productPageUrl: optionalValue(record, 'product_page_url'),
      detailImageUrls: expandedValues(record, 'detail_image_url', 9),
      approvedClaims,
      prohibitedClaims: expandedValues(record, 'prohibited_claim', 5),
      mustShowElements: expandedValues(record, 'must_show', 5),
      immutableElements: expandedValues(record, 'immutable_element', 5),
      targetAudience: value(record, 'target_audience'),
      campaignGoal: value(record, 'campaign_goal'),
      platform: value(record, 'platform'),
      durationSeconds: Number(value(record, 'duration_seconds')),
      brandKitId: brandKit.brandKitId,
      brandKitName: brandKit.brandKitName,
      cta: value(record, 'cta'),
      referenceVideoUrl,
      referenceRights,
      referenceMode,
      notes: optionalValue(record, 'notes'),
    },
    mappingIssue: brandKit.issue,
  };
}

function readinessIssues(result: ReturnType<typeof validateSkuReadiness>, hasMappingIssue: boolean): CsvImportIssue[] {
  return result.issues
    .filter((entry) => !hasMappingIssue || entry.code !== 'missing_brand_kit')
    .map((entry) => ({ code: entry.code, field: entry.field, message: entry.message }));
}

function normalizationContext(options: CsvParseOptions, version: CsvTemplateVersion): CsvNormalizationContext {
  return {
    version,
    brandKits: options.brandKits ?? [],
    workspaceName: options.workspaceName?.trim() || 'current workspace',
  };
}

export function parseCsvDocument(input: string | Uint8Array, options: CsvParseOptions = {}): ParsedCsvDocument {
  const text = typeof input === 'string' ? input : new TextDecoder().decode(input);
  const version = templateVersionFromComments(text);
  const expectedVersion = options.expectedVersion ?? CSV_TEMPLATE_VERSION;
  const documentIssues: CsvImportIssue[] = [];

  if (version !== expectedVersion) {
    documentIssues.push(issue(
      'invalid_csv_template_version',
      'template_version',
      `CSV template version must be ${expectedVersion}.`,
    ));
  }

  let records: string[][];
  try {
    records = parse(text, {
      bom: true,
      comment: '#',
      relax_column_count: true,
      skip_empty_lines: true,
    }) as string[][];
  } catch (error) {
    documentIssues.push(issue(
      'csv_parse_error',
      'file',
      error instanceof Error ? error.message : 'CSV could not be parsed.',
    ));
    return { version, headers: [], rows: [], issues: documentIssues };
  }

  const headers = (records.shift() ?? []).map((header) => header.trim());
  const headerResult = validateCsvHeaders(headers, expectedVersion);
  for (const column of headerResult.missing) {
    documentIssues.push(issue('missing_csv_column', column, `Required column ${column} is missing.`));
  }
  for (const column of headerResult.unknown) {
    documentIssues.push(issue('unknown_csv_column', column, `Unknown column ${column}.`));
  }
  for (const column of headerResult.duplicates) {
    documentIssues.push(issue('duplicate_csv_column', column, `Column ${column} appears more than once.`));
  }

  const context = normalizationContext(options, expectedVersion);
  const rows = records.slice(0, CSV_MAX_ROWS).map((values, index) => {
    const rowNumber = index + 2;
    const rawValues = trimRecord(headers, values);
    const rowIssues: CsvImportIssue[] = [];

    if (values.length !== headers.length) {
      rowIssues.push(issue(
        'invalid_csv_column_count',
        'row',
        `Expected ${headers.length} columns but received ${values.length}.`,
      ));
    }

    if (!headerResult.valid || version !== expectedVersion) {
      return {
        rowNumber,
        rawValues,
        normalizedValues: null,
        issues: rowIssues,
        readinessStatus: 'needs_input' as const,
      };
    }

    const normalized = normalizeRow(rawValues, context);
    if (normalized.mappingIssue) rowIssues.push(normalized.mappingIssue);
    const readiness = validateSkuReadiness({
      ...normalized.normalizedValues,
      primaryImageAuthorized: true,
    });
    rowIssues.push(...readinessIssues(readiness, Boolean(normalized.mappingIssue)));

    return {
      rowNumber,
      rawValues,
      normalizedValues: normalized.normalizedValues,
      issues: rowIssues,
      readinessStatus: readiness.status === 'ready' && !normalized.mappingIssue ? 'ready' as const : 'needs_input' as const,
    };
  });

  if (records.length > CSV_MAX_ROWS) {
    documentIssues.push(issue(
      'csv_max_rows_exceeded',
      'file',
      `CSV files may contain at most ${CSV_MAX_ROWS} data rows.`,
    ));
  }

  return { version, headers, rows, issues: documentIssues };
}

export function normalizeCsvRecord(
  rawValues: Record<string, string>,
  context: CsvNormalizationContext,
): {
  normalizedValues: NormalizedCsvRow;
  issues: CsvImportIssue[];
  readinessStatus: 'ready' | 'needs_input';
} {
  const normalized = normalizeRow(rawValues, context);
  const readiness = validateSkuReadiness({
    ...normalized.normalizedValues,
    primaryImageAuthorized: true,
  });
  const issues = [
    ...(normalized.mappingIssue ? [normalized.mappingIssue] : []),
    ...readinessIssues(readiness, Boolean(normalized.mappingIssue)),
  ];
  return {
    normalizedValues: normalized.normalizedValues,
    issues,
    readinessStatus: readiness.status === 'ready' && !normalized.mappingIssue ? 'ready' : 'needs_input',
  };
}

export function findDuplicateExternalSkuRows(rows: readonly ParsedCsvRow[]): number[] {
  const firstRowBySku = new Map<string, number>();
  const duplicateRows = new Set<number>();
  for (const row of rows) {
    const sku = row.normalizedValues?.externalSku;
    if (!sku) continue;
    const firstRow = firstRowBySku.get(sku);
    if (firstRow !== undefined) {
      duplicateRows.add(firstRow);
      duplicateRows.add(row.rowNumber);
    } else {
      firstRowBySku.set(sku, row.rowNumber);
    }
  }
  return [...duplicateRows].sort((left, right) => left - right);
}

export const csvColumns = [...CSV_ALL_COLUMNS];
