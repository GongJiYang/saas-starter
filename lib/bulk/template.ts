import { CSV_ALL_COLUMNS, CSV_MAX_ROWS, CSV_TEMPLATE_VERSION } from './contracts';

function escapeCsvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function createCsvTemplate(brandKits: readonly { name: string }[] = []): string {
  const descriptions: Record<string, string> = {
    external_sku: 'workspace-unique SKU',
    product_name: 'approved product name',
    category: 'product category',
    primary_image_url: 'HTTPS product image URL',
    approved_claim_1: 'approved claim text',
    approved_claim_source_1: 'claim evidence source',
    prohibited_claim_1: 'prohibited claim or wording',
    must_show_1: 'required visible element',
    immutable_element_1: 'element that must not change',
    target_audience: 'target audience',
    campaign_goal: 'campaign goal',
    platform: 'target platform',
    duration_seconds: '4-15 seconds',
    brand_kit_name: 'current Workspace Brand Kit name',
    cta: 'approved call to action',
    product_page_url: 'optional HTTPS product page',
    reference_video_url: 'optional HTTPS reference video',
    reference_rights: 'owned, licensed, or inspiration_only',
    reference_mode: 'structure or owned_template',
    notes: 'optional internal note',
  };

  const example: Record<string, string> = {
    external_sku: 'SKU-EXAMPLE-001',
    product_name: 'Example product',
    category: 'fragrance',
    primary_image_url: 'https://assets.example.com/product.jpg',
    approved_claim_1: 'Compact glass bottle',
    approved_claim_source_1: 'Approved product sheet',
    prohibited_claim_1: 'Medical treatment claim',
    must_show_1: 'Bottle and label',
    immutable_element_1: 'Bottle shape',
    target_audience: 'Mobile shoppers',
    campaign_goal: 'Product awareness',
    platform: 'tiktok',
    duration_seconds: '5',
    brand_kit_name: brandKits[0]?.name ?? '',
    cta: 'Learn more',
    product_page_url: 'https://shop.example.com/products/example',
    detail_image_url_1: 'https://assets.example.com/detail.jpg',
  };

  const comments = [
    `# csv_template_version=${CSV_TEMPLATE_VERSION}`,
    `# csv_max_rows=${CSV_MAX_ROWS}`,
    `# available_brand_kits=${brandKits.map((kit) => kit.name).join(' | ') || 'none'}`,
    `# ${CSV_ALL_COLUMNS.map((column) => `${column}: ${descriptions[column] ?? 'optional expanded field'}`).join('; ')}`,
  ];
  return createCsvDocument([example], comments);
}

export function createCsvDocument(
  rows: readonly Record<string, string>[],
  comments: readonly string[] = [
    `# csv_template_version=${CSV_TEMPLATE_VERSION}`,
    `# csv_max_rows=${CSV_MAX_ROWS}`,
  ],
): string {
  const header = CSV_ALL_COLUMNS.map(escapeCsvCell).join(',');
  const dataRows = rows.map((record) =>
    CSV_ALL_COLUMNS.map((column) => escapeCsvCell(record[column] ?? '')).join(','),
  );
  return `${[...comments, header, ...dataRows].join('\n')}\n`;
}
