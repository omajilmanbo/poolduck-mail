'use client';

import { FormEvent, useMemo, useState } from 'react';
import { ApiError, createPlatformApiClient } from '../../../src/api/client';

export default function PlatformLoginPage() {
  const api = useMemo(() => createPlatformApiClient(), []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.login(email.trim().toLowerCase(), password);
      setPassword('');
      window.location.assign('/platform');
    } catch (caught) {
      setPassword('');
      setError(
        caught instanceof ApiError ? caught.message : '平台登录失败，请稍后重试',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-400">
          Poolduck Control Plane
        </p>
        <h1 className="mt-3 text-2xl font-semibold">平台管理员登录</h1>
        <p className="mt-2 text-sm text-slate-400">
          该入口与租户工作台完全独立。
        </p>
        <label className="mt-6 block text-sm font-medium">
          平台邮箱
          <input
            data-testid="platform-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-2 w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-400"
            required
          />
        </label>
        <label className="mt-4 block text-sm font-medium">
          密码
          <input
            data-testid="platform-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-2 w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-400"
            required
          />
        </label>
        {error ? (
          <p className="mt-4 rounded-md border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        ) : null}
        <button
          data-testid="platform-login-submit"
          disabled={loading}
          className="mt-6 w-full rounded-md bg-cyan-500 px-4 py-2 font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
        >
          {loading ? '登录中…' : '进入平台控制台'}
        </button>
      </form>
    </main>
  );
}
