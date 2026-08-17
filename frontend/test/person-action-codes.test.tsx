import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from '@zxing/library';
import { toBuffer } from 'bwip-js/node';
import { PNG } from 'pngjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PersonActionCodesDialog from '../app/people/PersonActionCodesDialog';
import {
  RenderedPersonActionCode,
  createPersonActionCodeSpecs,
  getBarcodeOptions,
  personActionCodesZipFilename,
  validatePersonCode,
} from '../src/codes/person-action-codes';

const personCode = '01K0ABC70001';

describe('person action codes', () => {
  afterEach(() => cleanup());

  it('builds four PII-free action assets and safe filenames', () => {
    const specs = createPersonActionCodeSpecs(personCode);
    expect(specs.map((spec) => `${spec.action}-${spec.format}`)).toEqual([
      'entry-qr',
      'entry-code128',
      'exit-qr',
      'exit-code128',
    ]);
    expect(specs.map((spec) => spec.payload)).toEqual([
      `V2E${personCode}`,
      `V2E${personCode}`,
      `V2X${personCode}`,
      `V2X${personCode}`,
    ]);
    expect(specs.every((spec) => /^[A-Z0-9]{15}$/.test(spec.payload))).toBe(true);
    expect(specs.every((spec) => !/[|\s]/.test(spec.payload))).toBe(true);
    expect(specs.every((spec) => spec.filename.startsWith(personCode))).toBe(true);
    expect(JSON.stringify(specs)).not.toContain('person@example.local');
    expect(JSON.stringify(specs)).not.toContain('44444444-4444-4444-8444-444444444444');
    expect(personActionCodesZipFilename(personCode)).toBe(`${personCode}-action-codes.zip`);
  });

  it('rejects missing or invalid person codes without UUID fallback', () => {
    expect(() => validatePersonCode('')).toThrow('人员 ID 缺失或格式无效');
    expect(() => validatePersonCode('44444444-4444-4444-8444-444444444444')).toThrow(
      '人员 ID 缺失或格式无效',
    );
    expect(() => validatePersonCode('01K0ABCI0001')).toThrow('人员 ID 缺失或格式无效');
  });

  it('round-trips every QR and Code 128 payload through an open-source decoder', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      for (const spec of createPersonActionCodeSpecs(personCode)) {
        const png = await toBuffer(getBarcodeOptions(spec));
        expect(decodePng(png, spec.format)).toBe(spec.payload);
      }
    } finally {
      warn.mockRestore();
    }
  });

  it('uses product-neutral format tokens without tenant or product prefixes', () => {
    const payloads = createPersonActionCodeSpecs(personCode).map((spec) => spec.payload);
    expect(payloads).toEqual([
      `V2E${personCode}`,
      `V2E${personCode}`,
      `V2X${personCode}`,
      `V2X${personCode}`,
    ]);
    expect(payloads.every((payload) => !payload.includes('PD'))).toBe(true);
  });

  it('shows four previews and supports individual PNG plus ZIP downloads', async () => {
    const assets = renderedAssets();
    const renderCodes = vi.fn().mockResolvedValue(assets);
    const createZip = vi.fn().mockResolvedValue(new Blob(['zip']));
    const saveDataUrl = vi.fn();
    const saveBlob = vi.fn();

    render(
      <PersonActionCodesDialog
        personCode={personCode}
        onClose={vi.fn()}
        renderCodes={renderCodes}
        createZip={createZip}
        saveDataUrl={saveDataUrl}
        saveBlob={saveBlob}
      />,
    );

    expect(await screen.findAllByRole('img')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: '下载 进入二维码 PNG' }));
    expect(saveDataUrl).toHaveBeenCalledWith(
      assets[0].dataUrl,
      `${personCode}-entry-qr.png`,
    );

    fireEvent.click(screen.getByRole('button', { name: '下载全部四张图片 ZIP' }));
    await waitFor(() => expect(saveBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      `${personCode}-action-codes.zip`,
    ));
    expect(createZip).toHaveBeenCalledWith(assets);
  });

  it('shows a clear failure and keeps downloads unavailable when generation fails', async () => {
    render(
      <PersonActionCodesDialog
        personCode=""
        onClose={vi.fn()}
        renderCodes={vi.fn().mockRejectedValue(new Error('人员 ID 缺失或格式无效，无法生成动作码图片。'))}
      />,
    );
    expect((await screen.findByRole('alert')).textContent).toContain('人员 ID 缺失或格式无效');
    expect(screen.queryByText('下载全部四张图片 ZIP')).toBeNull();
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });
});

function renderedAssets(): RenderedPersonActionCode[] {
  return createPersonActionCodeSpecs(personCode).map((spec) => ({
    ...spec,
    dataUrl: `data:image/png;base64,${btoa(spec.payload)}`,
  }));
}

function decodePng(buffer: Buffer, format: 'qr' | 'code128'): string {
  const png = PNG.sync.read(buffer);
  const luminance = new Uint8ClampedArray(png.width * png.height);
  for (let source = 0, target = 0; source < png.data.length; source += 4, target += 1) {
    luminance[target] = (
      png.data[source] * 306
      + png.data[source + 1] * 601
      + png.data[source + 2] * 117
      + 512
    ) >> 10;
  }
  const source = new RGBLuminanceSource(luminance, png.width, png.height);
  const bitmap = new BinaryBitmap(new HybridBinarizer(source));
  const reader = new MultiFormatReader();
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    format === 'qr' ? BarcodeFormat.QR_CODE : BarcodeFormat.CODE_128,
  ]);
  reader.setHints(hints);
  return reader.decode(bitmap).getText();
}
