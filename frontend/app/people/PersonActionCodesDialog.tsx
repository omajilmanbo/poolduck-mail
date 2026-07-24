'use client';

import { useEffect, useState } from 'react';
import {
  RenderedPersonActionCode,
  createPersonActionCodesZip,
  downloadBlob,
  downloadDataUrl,
  personActionCodesZipFilename,
  renderPersonActionCodes,
} from '../../src/codes/person-action-codes';

type PersonActionCodesDialogProps = {
  personCode: string;
  onClose: () => void;
  renderCodes?: typeof renderPersonActionCodes;
  createZip?: typeof createPersonActionCodesZip;
  saveDataUrl?: typeof downloadDataUrl;
  saveBlob?: typeof downloadBlob;
};

export default function PersonActionCodesDialog({
  personCode,
  onClose,
  renderCodes = renderPersonActionCodes,
  createZip = createPersonActionCodesZip,
  saveDataUrl = downloadDataUrl,
  saveBlob = downloadBlob,
}: PersonActionCodesDialogProps) {
  const [assets, setAssets] = useState<RenderedPersonActionCode[]>([]);
  const [error, setError] = useState('');
  const [zipPending, setZipPending] = useState(false);

  useEffect(() => {
    let active = true;
    setAssets([]);
    setError('');
    renderCodes(personCode)
      .then((rendered) => { if (active) setAssets(rendered); })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : '动作码图片生成失败。');
      });
    return () => { active = false; };
  }, [personCode, renderCodes]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  async function downloadZip() {
    setZipPending(true);
    setError('');
    try {
      const blob = await createZip(assets);
      saveBlob(blob, personActionCodesZipFilename(personCode));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ZIP 下载生成失败。');
    } finally {
      setZipPending(false);
    }
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      role="dialog"
    >
      <section className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">人员进入/离开动作码</h2>
            <p className="mt-1 font-mono text-sm text-slate-600">{personCode || '人员 ID 缺失'}</p>
          </div>
          <button aria-label="关闭动作码预览" className="rounded border px-3 py-1.5" onClick={onClose}>关闭</button>
        </header>

        <p className="mb-4 text-sm text-slate-600">
          图片仅包含动作和人员 ID，不包含姓名、邮箱、tenant/location UUID，也不会上传或持久化。
        </p>
        {error ? <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p> : null}
        {!error && assets.length === 0 ? <p className="py-10 text-center text-slate-600">正在本地生成图片…</p> : null}

        {assets.length > 0 ? (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              {assets.map((asset) => (
                <article className="rounded-lg border p-4" key={`${asset.action}-${asset.format}`}>
                  <h3 className="mb-3 font-medium">{asset.title}</h3>
                  <div className="flex min-h-64 items-center justify-center overflow-auto rounded bg-slate-50 p-3">
                    <img alt={`${asset.title}预览`} className="max-h-80 max-w-full" src={asset.dataUrl} />
                  </div>
                  <p className="mt-2 break-all font-mono text-xs text-slate-600">{asset.payload}</p>
                  <button
                    className="mt-3 rounded border border-emerald-700 px-3 py-2 text-sm text-emerald-800"
                    onClick={() => saveDataUrl(asset.dataUrl, asset.filename)}
                  >
                    下载 {asset.title} PNG
                  </button>
                </article>
              ))}
            </div>
            <div className="mt-5 flex justify-end">
              <button
                className="rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-60"
                disabled={zipPending}
                onClick={() => void downloadZip()}
              >
                {zipPending ? '正在打包…' : '下载全部四张图片 ZIP'}
              </button>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
