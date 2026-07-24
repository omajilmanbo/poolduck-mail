export type PersonAction = 'entry' | 'exit';
export type PersonCodeFormat = 'qr' | 'code128';

export type PersonActionCodeSpec = {
  action: PersonAction;
  format: PersonCodeFormat;
  payload: string;
  filename: string;
  title: string;
};

export type RenderedPersonActionCode = PersonActionCodeSpec & {
  dataUrl: string;
};

const PERSON_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{12}$/;

export function validatePersonCode(personCode: string): string {
  if (!PERSON_CODE_PATTERN.test(personCode)) {
    throw new Error('人员 ID 缺失或格式无效，无法生成动作码图片。');
  }
  return personCode;
}

export function createPersonActionCodeSpecs(personCode: string): PersonActionCodeSpec[] {
  const validPersonCode = validatePersonCode(personCode);
  return (['entry', 'exit'] as const).flatMap((action) => {
    const actionToken = action.toUpperCase();
    const payload = `PD1|${actionToken}|${validPersonCode}`;
    const actionLabel = action === 'entry' ? '进入' : '离开';
    return (['qr', 'code128'] as const).map((format) => ({
      action,
      format,
      payload,
      filename: `${validPersonCode}-${action}-${format}.png`,
      title: `${actionLabel}${format === 'qr' ? '二维码' : '条形码'}`,
    }));
  });
}

export function getBarcodeOptions(spec: PersonActionCodeSpec) {
  const isQr = spec.format === 'qr';
  if (isQr) {
    return {
      bcid: 'qrcode',
      text: spec.payload,
      scale: 4,
      padding: 12,
      backgroundcolor: 'FFFFFF',
    };
  }
  return {
    bcid: 'code128',
    text: spec.payload,
    scale: 3,
    height: 18,
    includetext: true,
    textxalign: 'center' as const,
    padding: 16,
    backgroundcolor: 'FFFFFF',
  };
}

export async function renderPersonActionCodes(
  personCode: string,
): Promise<RenderedPersonActionCode[]> {
  const specs = createPersonActionCodeSpecs(personCode);
  const { toCanvas } = await import('bwip-js/browser');

  return specs.map((spec) => {
    const barcodeCanvas = document.createElement('canvas');
    toCanvas(barcodeCanvas, getBarcodeOptions(spec));
    const dataUrl = addActionLabel(barcodeCanvas, spec);
    return { ...spec, dataUrl };
  });
}

export function personActionCodesZipFilename(personCode: string): string {
  return `${validatePersonCode(personCode)}-action-codes.zip`;
}

export async function createPersonActionCodesZip(
  assets: RenderedPersonActionCode[],
): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const asset of assets) {
    const base64 = asset.dataUrl.split(',', 2)[1];
    if (!base64) {
      throw new Error('图片数据无效，无法创建 ZIP。');
    }
    zip.file(asset.filename, base64, { base64: true });
  }
  return zip.generateAsync({ type: 'blob' });
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  triggerDownload(dataUrl, filename);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    triggerDownload(url, filename);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function addActionLabel(
  barcodeCanvas: HTMLCanvasElement,
  spec: PersonActionCodeSpec,
): string {
  const headerHeight = 58;
  const footerHeight = 42;
  const horizontalPadding = 24;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(barcodeCanvas.width + horizontalPadding * 2, 420);
  canvas.height = barcodeCanvas.height + headerHeight + footerHeight;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('浏览器无法创建图片画布。');
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = spec.action === 'entry' ? '#d1fae5' : '#ffedd5';
  context.fillRect(0, 0, canvas.width, headerHeight);
  context.fillStyle = '#0f172a';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = 'bold 24px Arial, sans-serif';
  context.fillText(
    spec.action === 'entry' ? '▶ ENTRY / 进入' : '◀ EXIT / 离开',
    canvas.width / 2,
    headerHeight / 2,
  );
  context.drawImage(
    barcodeCanvas,
    Math.floor((canvas.width - barcodeCanvas.width) / 2),
    headerHeight,
  );
  context.font = '16px monospace';
  context.fillText(spec.payload, canvas.width / 2, canvas.height - footerHeight / 2);
  return canvas.toDataURL('image/png');
}

function triggerDownload(url: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
