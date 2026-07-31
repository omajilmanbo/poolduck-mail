'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ApiError, createApiClient } from '../../src/api/client';

export default function ChangePasswordPage() {
  const api = useMemo(() => createApiClient(), []);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .getMe()
      .then(({ user }) => {
        if (!user.must_change_password) window.location.replace('/');
        else setReady(true);
      })
      .catch(() => window.location.replace('/'));
  }, [api]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmation) {
      setError('两次输入的密码不一致。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.changeInitialPassword(password);
      setPassword('');
      setConfirmation('');
      window.location.replace('/');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '修改密码失败');
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return <main className="p-8 text-sm text-slate-600">正在验证登录状态…</main>;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-100 px-5">
      <form onSubmit={submit} className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">首次登录修改密码</h1>
        <p className="mt-2 text-sm text-slate-600">临时密码只能用于首次登录。新密码至少 8 位，并同时包含英文字母和数字。</p>
        <label className="mt-5 block text-sm font-medium">新密码<input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2" required /></label>
        <label className="mt-4 block text-sm font-medium">再次输入<input type="password" autoComplete="new-password" minLength={8} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2" required /></label>
        {error ? <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <button disabled={busy} className="mt-5 w-full rounded-md bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? '提交中…' : '修改并重新登录'}</button>
      </form>
    </main>
  );
}
