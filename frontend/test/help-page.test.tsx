import { execFileSync } from 'node:child_process';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HelpPage from '../app/help/page';
import HomePage from '../app/page';
import manual from '../src/help/content.json';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('HTML user guide', () => {
  it('renders the key sections, role boundaries and accurate mail states without a business request', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<HelpPage />);

    expect(screen.getByRole('heading', { level: 1, name: '使用手册' })).not.toBeNull();
    for (const section of manual.sections) {
      expect(screen.getByRole('heading', { level: 2, name: section.title })).not.toBeNull();
    }
    expect(screen.getByText(/operator 只能看到租户管理员已分配的地点/)).not.toBeNull();
    expect(screen.getByText(/tenant_manager 可使用“人员管理”“用户管理”“地点管理”和租户“审计”入口/)).not.toBeNull();
    expect(screen.getByText(/OCI 模式仅表示邮件服务已接受提交，不代表邮件已到达收件箱/)).not.toBeNull();
    expect(screen.getByText(/既不能认定已送达，也不能认定发送失败/)).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    const main = container.querySelector('main');
    expect(main?.className).toContain('px-4');
    expect(main?.className).toContain('sm:px-6');
    expect(container.querySelector('nav ul')?.className).toContain('flex-wrap');
  });

  it('offers keyboard reachable skip, section and return links', () => {
    render(<HelpPage />);
    const skip = screen.getByRole('link', { name: '跳到手册正文' });
    const section = screen.getByRole('link', { name: '邮件任务状态' });
    const back = screen.getByRole('link', { name: '返回登录页或工作台' });
    expect(skip.getAttribute('href')).toBe('#help-content');
    expect(section.getAttribute('href')).toBe('#mail-status');
    expect(back.getAttribute('href')).toBe('/');
    for (const link of [skip, section, back]) {
      link.focus();
      expect(document.activeElement).toBe(link);
    }
  });

  it('keeps the Markdown summary generated from the same content file', () => {
    expect(() => execFileSync(process.execPath, ['scripts/sync-help-guide.mjs', '--check'], {
      cwd: process.cwd(), stdio: 'pipe',
    })).not.toThrow();
  });

  it('shows a new-tab help entry on the login page', () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ code: 'UNAUTHORIZED' }, 401)));
    render(<HomePage />);
    const link = screen.getByRole('link', { name: '使用手册（新标签页）' });
    expect(link.getAttribute('href')).toBe('/help');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('shows a new-tab help entry after tenant login', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/me')) return json({ user: { role: 'operator', username: 'synthetic-operator', email: null } });
      if (url.endsWith('/api/license/check')) return json({ status: 'active', can_send: true });
      if (url.endsWith('/api/locations')) return json([]);
      throw new Error(`Unexpected URL: ${url}`);
    }));
    render(<HomePage />);
    await waitFor(() => expect(screen.getByRole('heading', { name: '扫码工作台' })).not.toBeNull());
    const link = screen.getByRole('link', { name: '使用手册' });
    expect(link.getAttribute('href')).toBe('/help');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.parentElement?.querySelector('h1')?.textContent).toBe('扫码工作台');
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
