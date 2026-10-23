import { useEffect, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { MessageSquareText, FileText, BookMarked, MapPin, LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Image } from '@/components/ui/image';
import { base44 } from '@/api/base44Client';

const NAV = [
  { label: '智能体对话', path: '/', icon: MessageSquareText },
  { label: '报价记录', path: '/records', icon: FileText },
  { label: '知识库', path: '/knowledge', icon: BookMarked },
  { label: '城市节点', path: '/cities', icon: MapPin },
];

export default function AppShell() {
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar_collapsed') === '1');

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      localStorage.setItem('sidebar_collapsed', v ? '0' : '1');
      return !v;
    });
  };

  const handleLogout = async () => {
    await base44.auth.logout('/login');
  };

  return (
    <div className="flex h-screen bg-[#f6f7f9]">
      <aside className={`flex shrink-0 flex-col bg-[#14161a] text-zinc-400 transition-[width] duration-200 ${collapsed ? 'w-14' : 'w-60'}`}>
        <div className={`flex items-center pb-5 pt-6 ${collapsed ? 'flex-col gap-2 px-2' : 'gap-2.5 px-5'}`}>
          <Image
            src="https://media.base44.com/images/public/6ad812d27ab0b31c35ca48f8/6483c1ef8_logo.png"
            className="h-7 w-7 shrink-0"
            fittingType="fit"
          />
          {!collapsed && (
            <div className="min-w-0 flex-1 leading-tight">
              <div className="text-sm font-semibold text-white">物流通</div>
              <div className="text-[11px] text-zinc-500">智能报价助手</div>
            </div>
          )}
          <button
            onClick={toggleCollapsed}
            title={collapsed ? '展开菜单' : '收起菜单'}
            className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>
        <nav className={`mt-1 flex flex-col gap-0.5 ${collapsed ? 'px-2' : 'px-3'}`}>
          {NAV.map(({ label, path, icon: Icon }) => {
            const active = location.pathname === path;
            return (
              <Link
                key={path}
                to={path}
                title={label}
                className={`flex items-center rounded-lg text-sm transition-colors ${
                  collapsed ? 'justify-center py-2' : 'gap-2.5 px-3 py-2'
                } ${active ? 'bg-white/10 text-white' : 'hover:bg-white/5 hover:text-zinc-200'}`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && label}
                {!collapsed && active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#E8734A]" />}
              </Link>
            );
          })}
        </nav>
        <div className={`mt-auto border-t border-white/10 py-4 ${collapsed ? 'px-2' : 'px-4'}`}>
          <div className={`flex items-center gap-2 ${collapsed ? 'flex-col' : ''}`}>
            <div
              title={user?.full_name || user?.email}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-medium text-white"
            >
              {(user?.full_name || user?.email || '?').slice(0, 1).toUpperCase()}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-xs text-zinc-300">{user?.full_name || '未命名用户'}</div>
                <div className="truncate text-[11px] text-zinc-500">{user?.email}</div>
              </div>
            )}
            <button
              onClick={handleLogout}
              title="退出登录"
              className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}