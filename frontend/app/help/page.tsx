import manual from '../../src/help/content.json';

export const metadata = {
  title: '使用手册 | Poolduck Mail',
  description: '租户操作员和租户管理员的扫码工作台使用手册',
};

export default function HelpPage() {
  return (
    <>
      <a href="#help-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:shadow-lg">
        跳到手册正文
      </a>
      <main id="help-content" className="min-h-screen bg-stone-100 px-4 py-6 text-slate-950 sm:px-6 sm:py-10">
        <div className="mx-auto w-full max-w-4xl">
          <header className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Poolduck Mail</p>
            <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">{manual.title}</h1>
            <p className="mt-4 leading-7 text-slate-600">{manual.intro}</p>
            <a href="/" className="mt-5 inline-flex rounded-md border border-emerald-700 px-4 py-2 font-medium text-emerald-800 hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
              返回登录页或工作台
            </a>
            <p className="mt-2 text-sm text-slate-500">从应用入口打开时，关闭本标签页即可回到原页面，保留已输入的内容。</p>
          </header>

          <nav aria-label="手册章节" className="mt-5 rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
            <h2 className="font-semibold">快速跳转</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {manual.sections.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`} className="inline-flex rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
                    {section.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="mt-5 space-y-5">
            {manual.sections.map((section) => (
              <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="scroll-mt-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
                <h2 id={`${section.id}-title`} className="text-xl font-semibold sm:text-2xl">{section.title}</h2>
                <ul className="mt-4 list-disc space-y-3 pl-5 leading-7 text-slate-700 marker:text-emerald-700">
                  {section.items.map((item) => <li key={item} className="break-words">{item}</li>)}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
